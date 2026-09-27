//! A dedicated, cancellable CLI login. Credentials stay with Antigravity's
//! keyring; raw terminal output and pasted codes never enter app events/logs.
use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use serde::Serialize;
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, State};

#[derive(Default)]
struct TerminalReplies(String);
impl vt100::Callbacks for TerminalReplies {
    fn unhandled_csi(
        &mut self,
        screen: &mut vt100::Screen,
        i1: Option<u8>,
        _i2: Option<u8>,
        params: &[&[u16]],
        c: char,
    ) {
        if i1.is_none() && c == 'n' && params.first() == Some(&&[6][..]) {
            let (row, col) = screen.cursor_position();
            self.0.push_str(&format!("\x1b[{};{}R", row + 1, col + 1));
        } else if i1.is_none() && c == 'c' {
            self.0.push_str("\x1b[?1;2c");
        }
    }
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    phase: &'static str,
    url: Option<String>,
    message: &'static str,
}
struct Session {
    id: String,
    snapshot: Mutex<Snapshot>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    _master: Mutex<Box<dyn MasterPty + Send>>,
}
impl Session {
    fn active(&self) -> bool {
        matches!(
            self.snapshot.lock().unwrap().phase,
            "starting" | "code" | "verifying"
        )
    }
    fn finish(&self, phase: &'static str, message: &'static str) {
        {
            let mut state = self.snapshot.lock().unwrap();
            if !matches!(state.phase, "starting" | "code" | "verifying") {
                return;
            }
            *state = Snapshot {
                phase,
                url: None,
                message,
            };
        }
        self.stop();
    }
    fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            if child.try_wait().ok().flatten().is_none() {
                #[cfg(windows)]
                if let Some(pid) = child.process_id() {
                    crate::runner::terminate_tree(pid);
                }
                let _ = child.kill();
            }
            let _ = child.wait();
        }
    }
    fn write(&self, text: &str) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "Sign-in input is unavailable.")?;
        writer
            .write_all(text.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|_| "The sign-in session ended. Start again.".into())
    }
}
#[derive(Default)]
pub struct AuthState(Mutex<Option<Arc<Session>>>);
impl AuthState {
    pub fn shutdown(&self) {
        if let Some(session) = self.0.lock().unwrap().take() {
            session.finish("cancelled", "Sign-in cancelled.");
        }
    }
    fn session(&self, id: &str) -> Result<Arc<Session>, String> {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .filter(|s| s.id == id)
            .cloned()
            .ok_or_else(|| "This sign-in session has ended. Start again.".into())
    }
}

fn authorization_url(screen: &str) -> Option<String> {
    let start = screen.find("https://accounts.google.com/")?;
    // The TUI can wrap its URL. Stop at its separator or explanatory text.
    let url: String = screen[start..]
        .lines()
        .map(str::trim)
        .take_while(|line| !line.is_empty() && line.bytes().all(|b| b.is_ascii_graphic()))
        .collect();
    let parsed = tauri::Url::parse(&url).ok()?;
    (parsed.scheme() == "https"
        && parsed.host_str() == Some("accounts.google.com")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query_pairs().any(|(key, _)| key == "state")
        && parsed.query_pairs().any(|(key, _)| key == "code_challenge"))
    .then_some(url)
}
fn login_error(screen: &str) -> bool {
    let text = screen.to_ascii_lowercase();
    [
        "got an error:",
        "token exchange failed",
        "authentication failed",
        "invalid_grant",
        "failed to sign in",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}
fn valid_code(code: &str) -> bool {
    (10..=4096).contains(&code.len())
        && code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/-_.~".contains(&b))
}

// `agy models` requires a valid account and never starts an agent turn. Checking
// its exit status avoids guessing success from a disappearing code prompt.
fn verified(path: &std::path::Path, session: &Session) -> bool {
    let mut cmd = Command::new(path);
    cmd.arg("models")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    let start = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return status.success();
        }
        if !session.active() || start.elapsed() > Duration::from_secs(8) {
            #[cfg(windows)]
            crate::runner::terminate_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
pub fn antigravity_login_start(
    app: tauri::AppHandle,
    state: State<AuthState>,
    id: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid sign-in session.")?;
    let path = crate::providers::Provider::Antigravity
        .resolve()
        .ok_or("Install the Antigravity CLI first.")?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not open app data.")?
        .join("sign-in");
    std::fs::create_dir_all(&workspace).map_err(|_| "Could not prepare sign-in.")?;
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 60,
            cols: 160,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|_| "Could not start sign-in terminal.")?;
    let log_path = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let mut cmd = if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
    {
        let mut cmd = portable_pty::CommandBuilder::new("powershell");
        cmd.args([
            "-NoLogo",
            "-NoProfile",
            "-Command",
            "& $env:VELUM_AUTH_CLI --log-file $env:VELUM_AUTH_LOG; exit $LASTEXITCODE",
        ]);
        cmd.env("VELUM_AUTH_CLI", &path);
        cmd.env("VELUM_AUTH_LOG", log_path);
        cmd
    } else {
        let mut cmd = crate::pty::build_command(&path);
        cmd.args(["--log-file", log_path]);
        cmd
    };
    cmd.cwd(&workspace);
    // Use the CLI's documented manual-code flow, with browser opening controlled
    // by the dialog. This does not alter the user's global environment.
    cmd.env("SSH_CONNECTION", "127.0.0.1 1 127.0.0.1 22");
    let writer = pair
        .master
        .take_writer()
        .map_err(|_| "Could not attach sign-in input.")?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| "Could not read sign-in progress.")?;
    let mut guard = state.0.lock().unwrap();
    if let Some(previous) = guard.take() {
        previous.finish("cancelled", "Sign-in restarted.");
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|_| "Could not launch Antigravity sign-in.")?;
    let session = Arc::new(Session {
        id,
        snapshot: Mutex::new(Snapshot {
            phase: "starting",
            url: None,
            message: "Preparing Google sign-in…",
        }),
        writer: Mutex::new(writer),
        child: Mutex::new(Some(child)),
        _master: Mutex::new(pair.master),
    });
    *guard = Some(session.clone());
    drop(guard);
    let reading = session.clone();
    std::thread::spawn(move || {
        let mut parser = vt100::Parser::new_with_callbacks(60, 160, 0, TerminalReplies::default());
        let mut buf = [0; 8192];
        let mut selected = false;
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || !reading.active() {
                break;
            }
            parser.process(&buf[..n]);
            let replies = std::mem::take(&mut parser.callbacks_mut().0);
            if !replies.is_empty() && reading.write(&replies).is_err() {
                break;
            }
            let screen = parser.screen().contents();
            if login_error(&screen) {
                reading.finish("error", "Google could not accept that sign-in. Start again for a fresh code, and check your connection if it keeps failing.");
                break;
            }
            if !selected
                && screen.contains("Select login method:")
                && screen.contains("> 1. Google OAuth")
            {
                selected = true;
                if reading.write("\r").is_err() {
                    break;
                }
            }
            if screen.contains("authorization code") {
                if let Some(url) = authorization_url(&screen) {
                    let mut state = reading.snapshot.lock().unwrap();
                    if state.phase == "starting" {
                        *state = Snapshot {
                            phase: "code",
                            url: Some(url),
                            message: "Sign in with Google, then paste the code from your browser.",
                        };
                    }
                }
            }
        }
        reading.finish(
            "error",
            "The sign-in process closed. Start again to get a fresh code.",
        );
    });
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut checking_since = None;
        // Also recognizes an account already saved in the CLI's keyring.
        if verified(&path, &session) {
            session.finish("complete", "Antigravity is connected.");
            return;
        }
        loop {
            if !session.active() {
                break;
            }
            let phase = session.snapshot.lock().unwrap().phase;
            if phase == "verifying" {
                let since = checking_since.get_or_insert_with(Instant::now);
                if verified(&path, &session) {
                    session.finish("complete", "Antigravity is connected.");
                    break;
                }
                if since.elapsed() > Duration::from_secs(60) {
                    session.finish("error", "We could not verify the account. Check your connection and start again with a fresh code.");
                    break;
                }
            }
            if phase == "starting" && started.elapsed() > Duration::from_secs(30) {
                session.finish("error", "Antigravity needs its first-launch setup. Open its Terminal view, finish the theme and workspace prompts, then try Sign in again.");
                break;
            }
            if started.elapsed() > Duration::from_secs(600) {
                session.finish(
                    "error",
                    "This sign-in expired. Start again to get a fresh code.",
                );
                break;
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    Ok(())
}
#[tauri::command]
pub fn antigravity_login_status(state: State<AuthState>, id: String) -> Result<Snapshot, String> {
    Ok(state.session(&id)?.snapshot.lock().unwrap().clone())
}
#[tauri::command]
pub fn antigravity_login_submit(
    state: State<AuthState>,
    id: String,
    code: String,
) -> Result<(), String> {
    let code = code.trim();
    if !valid_code(code) {
        return Err(
            "Paste only the authorization code shown by Google, without a URL or extra text."
                .into(),
        );
    }
    let session = state.session(&id)?;
    {
        let mut state = session.snapshot.lock().unwrap();
        if state.phase != "code" {
            return Err(
                "This sign-in is not waiting for a code. Start again if it expired.".into(),
            );
        }
        state.phase = "verifying";
        state.url = None;
        state.message = "Checking your sign-in…";
    }
    // Bracketed paste makes the TUI treat this as one paste, followed by Enter.
    if let Err(error) = session.write(&format!("\x1b[200~{code}\x1b[201~\r")) {
        session.finish("error", "The sign-in session ended. Start again.");
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
pub fn antigravity_login_cancel(state: State<AuthState>, id: String) {
    let mut guard = state.0.lock().unwrap();
    if guard.as_ref().is_some_and(|s| s.id == id) {
        if let Some(session) = guard.take() {
            session.finish("cancelled", "Sign-in cancelled.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn responds_to_split_console_cursor_queries() {
        let mut parser = vt100::Parser::new_with_callbacks(60, 160, 0, TerminalReplies::default());
        parser.process(b"\x1b[6");
        parser.process(b"n");
        assert_eq!(parser.callbacks().0, "\x1b[1;1R");
    }
    #[test]
    fn wrapped_oauth_url_excludes_terminal_instructions() {
        let text = "Open URL:\n https://accounts.google.com/o/oauth2/auth?state=abc&\n code_challenge=def\n ─────\n authorization code...";
        assert_eq!(
            authorization_url(text).unwrap(),
            "https://accounts.google.com/o/oauth2/auth?state=abc&code_challenge=def"
        );
        assert!(
            authorization_url("https://accounts.google.com/evil@other.example/?state=x").is_none()
        );
    }
    #[test]
    fn only_one_code_can_be_pasted() {
        assert!(valid_code("4/example-code_123"));
        for code in [
            "",
            "https://example.com",
            "code\r/logout",
            "code\x1b[2J",
            "code with spaces",
        ] {
            assert!(!valid_code(code));
        }
    }
    #[test]
    fn redraw_removes_old_prompt_and_keeps_error_detection() {
        let mut parser = vt100::Parser::new(60, 160, 0);
        parser.process(b"Select login method:\r\n> 1. Google OAuth");
        parser.process(b"\x1b[2J\x1b[HGot an error: token exchange failed: invalid_grant");
        let text = parser.screen().contents();
        assert!(login_error(&text));
        assert!(!text.contains("Select login method:"));
    }
}
