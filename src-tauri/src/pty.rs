use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

const READ_CHUNK: usize = 8192;
const EXIT_POLL_ATTEMPTS: u32 = 20;
const EXIT_POLL_INTERVAL_MS: u64 = 50;
type PtyChild = Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    child: PtyChild,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyState {
    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                stop_child(&session.child);
            }
        }
    }
}

fn stop_child(handle: &PtyChild) {
    let child = handle.lock().ok().and_then(|mut child| child.take());
    if let Some(mut child) = child {
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

#[derive(serde::Serialize, Clone)]
pub struct SpawnInfo {
    pub id: String,
    pub backend: String,
}

/// Build the spawn command for the resolved binary. Script shims
/// (`.cmd`/`.bat`/`.ps1`) cannot be launched directly through ConPTY,
/// so they are wrapped in their interpreter.
pub(crate) fn build_command(muse_path: &Path) -> CommandBuilder {
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
            // ConPTY's builder does not apply Rust's special batch-file
            // quoting. Pass the path as data so spaces, &, and % cannot
            // become shell syntax or environment-variable expansions.
            let mut cmd = CommandBuilder::new("powershell");
            cmd.args([
                "-NoLogo",
                "-NoProfile",
                "-Command",
                "& $env:MUSE_CODE_CLI; exit $LASTEXITCODE",
            ]);
            cmd.env("MUSE_CODE_CLI", muse_path);
            cmd
        }
        _ => CommandBuilder::new(muse_path),
    }
}

pub(crate) fn home_dir() -> PathBuf {
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

fn drain_valid_utf8(pending: &mut Vec<u8>) -> String {
    let mut output = String::new();
    let mut total = 0;
    loop {
        let (text, consumed) = split_valid_utf8(&pending[total..]);
        if consumed == 0 {
            break;
        }
        output.push_str(&text);
        total += consumed;
    }
    pending.drain(..total);
    output
}

fn kill_session(state: &State<PtyState>, id: &str) {
    let session = state
        .sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(id));
    if let Some(session) = session {
        stop_child(&session.child);
    }
}

/// Poll for the child exit code after EOF, then report it. `try_wait` is
/// used instead of blocking `wait` so a wedged child cannot deadlock the
/// reader thread against `pty_kill`.
fn report_exit_code(app: &AppHandle, id: &str, child: &PtyChild) {
    let mut code: Option<u32> = None;
    for _ in 0..EXIT_POLL_ATTEMPTS {
        let found = child
            .lock()
            .ok()
            .and_then(|mut child| child.as_mut().and_then(|c| c.try_wait().ok().flatten()));
        if let Some(status) = found {
            code = Some(status.exit_code());
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(EXIT_POLL_INTERVAL_MS));
    }
    let state = app.state::<PtyState>();
    let session = state.sessions.lock().ok().and_then(|mut sessions| {
        if sessions
            .get(id)
            .is_some_and(|s| Arc::ptr_eq(&s.child, child))
        {
            sessions.remove(id)
        } else {
            None
        }
    });
    if let Some(session) = session {
        stop_child(&session.child);
        let _ = app.emit("pty-exit", serde_json::json!({ "id": id, "code": code }));
    }
}

fn spawn_reader(app: AppHandle, id: String, child: PtyChild, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = [0u8; READ_CHUNK];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = drain_valid_utf8(&mut pending);
                    if !text.is_empty() {
                        let _ = app.emit("pty-data", serde_json::json!({ "id": id, "data": text }));
                    }
                }
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            let text = String::from_utf8_lossy(&pending).into_owned();
            if !text.is_empty() {
                let _ = app.emit("pty-data", serde_json::json!({ "id": id, "data": text }));
            }
        }
        report_exit_code(&app, &id, &child);
    });
}

/// Spawn the `muse` CLI inside a new PTY registered under `id`,
/// replacing any session already registered under that id.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<PtyState>,
    id: String,
    cols: u16,
    rows: u16,
    workspace: Option<String>,
    provider: Option<crate::providers::Provider>,
) -> Result<SpawnInfo, String> {
    let workspace = crate::runner::resolve_workspace(workspace)?;
    kill_session(&state, &id);
    let provider = provider.unwrap_or_default();
    let muse_path = provider.resolve().ok_or_else(|| provider.missing())?;
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
    cmd.cwd(&workspace);
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to attach terminal input: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to attach terminal output: {e}"))?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let child =
        Arc::new(Mutex::new(Some(pair.slave.spawn_command(cmd).map_err(
            |e| format!("failed to launch `{}`: {e}", muse_path.display()),
        )?)));
    sessions.insert(
        id.clone(),
        PtySession {
            master: pair.master,
            writer: Mutex::new(writer),
            child: Arc::clone(&child),
        },
    );
    drop(sessions);
    spawn_reader(app, id.clone(), child, reader);
    Ok(SpawnInfo {
        id,
        backend: muse_path.display().to_string(),
    })
}

/// Write keystrokes / pasted input to the session's PTY.
#[tauri::command]
pub fn pty_write(state: State<PtyState>, id: String, data: String) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "session not found".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "terminal input is unavailable".to_string())?;
    use std::io::Write;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("failed to write to terminal: {e}"))?;
    writer
        .flush()
        .map_err(|e| format!("failed to flush terminal: {e}"))?;
    Ok(())
}

/// Notify the session's PTY (and the TUI inside it) of a new terminal size.
#[tauri::command]
pub fn pty_resize(state: State<PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "session not found".to_string())?;
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

/// Terminate the session registered under `id`, if any. Always succeeds.
#[tauri::command]
pub fn pty_kill(state: State<PtyState>, id: String) -> Result<(), String> {
    kill_session(&state, &id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{drain_valid_utf8, split_valid_utf8};

    #[test]
    fn invalid_bytes_do_not_delay_valid_tail_until_another_read() {
        let mut pending = b"a\xffb\xfec".to_vec();
        assert_eq!(drain_valid_utf8(&mut pending), "a\u{fffd}b\u{fffd}c");
        assert!(pending.is_empty());
    }

    #[test]
    fn drain_keeps_only_incomplete_utf8_for_the_next_read() {
        let mut pending = vec![b'a', 0xff, 0xe2, 0x94];
        assert_eq!(drain_valid_utf8(&mut pending), "a\u{fffd}");
        assert_eq!(pending, vec![0xe2, 0x94]);
        pending.extend_from_slice(&[0x80, b'b']);
        assert_eq!(drain_valid_utf8(&mut pending), "─b");
        assert!(pending.is_empty());
    }

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
        assert_eq!(text, "a\u{FFFD}");
        assert_eq!(consumed, 2);
    }

    #[test]
    fn empty_input_is_empty_output() {
        let (text, consumed) = split_valid_utf8(b"");
        assert_eq!(text, "");
        assert_eq!(consumed, 0);
    }
}
