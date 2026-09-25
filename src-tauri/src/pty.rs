use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const READ_CHUNK: usize = 8192;
const EXIT_POLL_ATTEMPTS: u32 = 20;
const EXIT_POLL_INTERVAL_MS: u64 = 50;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
}

#[derive(Default)]
pub struct PtyState {
    session: Mutex<Option<PtySession>>,
}

/// Locate the `muse` CLI on PATH, honouring PATHEXT on Windows so shims
/// like `muse.cmd` resolve to a real file.
fn resolve_muse() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    #[cfg(windows)]
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .map(|s| s.to_string())
        .collect();
    for dir in std::env::split_paths(&path) {
        #[cfg(windows)]
        {
            for ext in &exts {
                let candidate = dir.join(format!("muse{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
            let bare = dir.join("muse");
            if bare.is_file() {
                return Some(bare);
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = dir.join("muse");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Build the spawn command for the resolved binary. Script shims
/// (`.cmd`/`.bat`/`.ps1`) cannot be launched directly through ConPTY,
/// so they are wrapped in their interpreter.
fn build_command(muse_path: &Path) -> CommandBuilder {
    let ext = muse_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("ps1") => {
            let mut cmd = CommandBuilder::new("powershell");
            cmd.arg("-NoProfile");
            cmd.arg("-ExecutionPolicy");
            cmd.arg("Bypass");
            cmd.arg("-File");
            cmd.arg(muse_path);
            cmd
        }
        Some("cmd" | "bat") => {
            let mut cmd = CommandBuilder::new("cmd");
            cmd.arg("/c");
            cmd.arg(muse_path);
            cmd
        }
        _ => CommandBuilder::new(muse_path),
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|d| d.is_dir())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// Split `buf` into the longest valid UTF-8 prefix plus the number of bytes
/// consumed. A trailing incomplete sequence is left unconsumed so the caller
/// can carry it into the next read; genuinely invalid bytes become U+FFFD.
/// This keeps multi-byte TUI output (box drawing, spinners) intact even when
/// a codepoint straddles two reads.
fn split_valid_utf8(buf: &[u8]) -> (String, usize) {
    match std::str::from_utf8(buf) {
        Ok(s) => (s.to_owned(), buf.len()),
        Err(e) => {
            let up_to = e.valid_up_to();
            let mut out = std::str::from_utf8(&buf[..up_to]).unwrap_or("").to_owned();
            let mut consumed = up_to;
            if let Some(len) = e.error_len() {
                out.push('\u{FFFD}');
                consumed += len;
            }
            (out, consumed)
        }
    }
}

fn kill_session(state: &State<PtyState>) {
    if let Ok(mut guard) = state.session.lock() {
        if let Some(session) = guard.take() {
            if let Ok(mut child) = session.child.lock() {
                if let Some(mut child) = child.take() {
                    let _ = child.kill();
                }
            }
        }
    }
}

/// Poll for the child exit code after EOF, then report it. `try_wait` is
/// used instead of blocking `wait` so a wedged child cannot deadlock the
/// reader thread against `pty_kill`.
fn report_exit_code(app: &AppHandle) {
    let mut code: Option<u32> = None;
    for _ in 0..EXIT_POLL_ATTEMPTS {
        let found = app
            .state::<PtyState>()
            .session
            .lock()
            .ok()
            .and_then(|session| {
                session.as_ref().and_then(|s| {
                    s.child
                        .lock()
                        .ok()
                        .and_then(|mut child| child.as_mut().and_then(|c| c.try_wait().ok().flatten()))
                })
            });
        if let Some(status) = found {
            code = Some(status.exit_code());
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(EXIT_POLL_INTERVAL_MS));
    }
    let _ = app.emit("pty-exit", serde_json::json!({ "code": code }));
}

fn spawn_reader(app: AppHandle, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = [0u8; READ_CHUNK];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let (text, consumed) = split_valid_utf8(&pending);
                    if !text.is_empty() {
                        let _ = app.emit("pty-data", text);
                    }
                    pending.drain(..consumed);
                }
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            let text = String::from_utf8_lossy(&pending).into_owned();
            if !text.is_empty() {
                let _ = app.emit("pty-data", text);
            }
        }
        report_exit_code(&app);
    });
}

/// Spawn the `muse` CLI inside a new PTY, replacing any existing session.
/// Returns the resolved path of the CLI for display in the UI.
#[tauri::command]
pub fn pty_spawn(app: AppHandle, state: State<PtyState>, cols: u16, rows: u16) -> Result<String, String> {
    kill_session(&state);
    let muse_path = resolve_muse().ok_or_else(|| {
        "Could not find the `muse` CLI on PATH. Install the Muse CLI and make sure `muse` works in a terminal, then restart the session.".to_string()
    })?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open terminal: {e}"))?;
    let mut cmd = build_command(&muse_path);
    cmd.cwd(home_dir());
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to launch `{}`: {e}", muse_path.display()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to attach terminal input: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to attach terminal output: {e}"))?;
    *state
        .session
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())? = Some(PtySession {
        master: pair.master,
        writer: Mutex::new(writer),
        child: Mutex::new(Some(child)),
    });
    spawn_reader(app, reader);
    Ok(muse_path.display().to_string())
}

/// Write keystrokes / pasted input to the PTY.
#[tauri::command]
pub fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = session.as_ref().ok_or_else(|| "no active session".to_string())?;
    let mut writer = session.writer.lock().map_err(|_| "terminal input is unavailable".to_string())?;
    use std::io::Write;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("failed to write to terminal: {e}"))?;
    writer.flush().map_err(|e| format!("failed to flush terminal: {e}"))?;
    Ok(())
}

/// Notify the PTY (and the TUI inside it) of a new terminal size.
#[tauri::command]
pub fn pty_resize(state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = session.as_ref().ok_or_else(|| "no active session".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to resize terminal: {e}"))?;
    Ok(())
}

/// Terminate the active session, if any. Always succeeds.
#[tauri::command]
pub fn pty_kill(state: State<PtyState>) -> Result<(), String> {
    kill_session(&state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::split_valid_utf8;

    #[test]
    fn valid_ascii_consumes_everything() {
        let (text, consumed) = split_valid_utf8(b"hello");
        assert_eq!(text, "hello");
        assert_eq!(consumed, 5);
    }

    #[test]
    fn split_multibyte_char_is_held_for_next_read() {
        let bytes = "─".as_bytes();
        assert_eq!(bytes.len(), 3);
        let (text, consumed) = split_valid_utf8(&bytes[..2]);
        assert_eq!(text, "");
        assert_eq!(consumed, 0);

        let mut carried: Vec<u8> = bytes[..2].to_vec();
        carried.extend_from_slice(&bytes[2..]);
        carried.extend_from_slice(b"ok");
        let (text, consumed) = split_valid_utf8(&carried);
        assert_eq!(text, "─ok");
        assert_eq!(consumed, carried.len());
    }

    #[test]
    fn invalid_byte_becomes_replacement_char() {
        let (text, consumed) = split_valid_utf8(b"a\xffb");
        assert_eq!(text, "a�");
        assert_eq!(consumed, 2);
    }

    #[test]
    fn empty_input_is_empty_output() {
        let (text, consumed) = split_valid_utf8(b"");
        assert_eq!(text, "");
        assert_eq!(consumed, 0);
    }
}
