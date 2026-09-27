//! One provider process per turn, bound to its tab and workspace.
//! Provider streams share one event vocabulary for desktop, phone and notifications.
//! Resume IDs come from the selected CLI; stderr is drained concurrently.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::AgentEvent;
use crate::provider_events::Stream;
use crate::provider_models::RunOptions;
use crate::providers::{self, Provider};
use crate::pty::home_dir;

/// Last stderr lines retained for failure diagnosis.
const STDERR_TAIL_LINES: usize = 30;

pub struct AgentSession {
    tab_id: String,
    session_id: Mutex<String>,
    provider: Provider,
    options: Mutex<RunOptions>,
    memory: Mutex<crate::memory::Session>,
    workspace: std::path::PathBuf,
    child: Mutex<Option<Child>>,
    running: Mutex<bool>,
    prompt: Mutex<Option<std::path::PathBuf>>,
}

#[derive(Default)]
pub struct AgentState {
    sessions: Mutex<HashMap<String, Arc<AgentSession>>>,
}

impl AgentSession {
    fn stop(&self) {
        let child = self.child.lock().ok().and_then(|mut child| child.take());
        let prompt = self.prompt.lock().ok().and_then(|mut file| file.take());
        if let Some(child) = child {
            kill_tree(child);
        }
        // App exit may end reader threads before their guards can drop.
        if let Some(file) = prompt {
            drop(StagedPrompt(file));
        }
    }
}

impl AgentState {
    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                session.stop();
            }
        }
    }
}

#[derive(serde::Serialize, Clone)]
pub struct NewInfo {
    pub id: String,
    pub session_id: String,
    pub workspace: String,
}

#[derive(serde::Serialize, Clone)]
pub struct TurnInfo {
    pub id: String,
    pub turn_id: String,
}

fn emit(app: &AppHandle, id: &str, event: AgentEvent) {
    app.state::<crate::session_log::SessionLog>()
        .record(id, &event);
    crate::remote::changed(app);
    // Emit failures mean the window is gone; nothing left to report to.
    let _ = app.emit(
        "agent-event",
        serde_json::json!({ "id": id, "event": event }),
    );
}

/// Filename-safe fragment derived from a tab id.
fn safe_fragment(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn prompt_file(id: &str) -> std::path::PathBuf {
    std::env::temp_dir()
        .join(format!("velum-code-{}", safe_fragment(id)))
        .join("prompt.txt")
}

/// Each turn owns its staging file. Failed spawns and completed turns both
/// remove it, without racing a replacement turn or retaining prompt text.
struct StagedPrompt(std::path::PathBuf);
impl Drop for StagedPrompt {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
        if let Some(dir) = self.0.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }
}

/// Resolve the workspace for a new agent session: an explicit directory
/// must exist, otherwise the tab falls back to the user's home directory
/// (the historical default).
pub(crate) fn resolve_workspace(workspace: Option<String>) -> Result<std::path::PathBuf, String> {
    match workspace
        .map(|w| w.trim().to_owned())
        .filter(|w| !w.is_empty())
    {
        None => Ok(home_dir()),
        Some(dir) => {
            let path = std::path::PathBuf::from(&dir);
            if !path.is_dir() {
                return Err(format!("workspace is not a directory: {dir}"));
            }
            Ok(path)
        }
    }
}

#[tauri::command]
pub fn agent_validate_workspace(workspace: Option<String>) -> Result<String, String> {
    resolve_workspace(workspace).map(|path| path.display().to_string())
}

/// Take the tab's child (if any), kill it, and reap it. The reader thread
/// observes the missing child after EOF and reports the turn cancelled.
fn kill_session(state: &State<AgentState>, id: &str) {
    let session = state
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(id).cloned());
    if let Some(session) = session {
        session.stop();
    }
}

/// Kill a child and its whole process tree, then reap it. Tree kill matters
/// on Windows: `muse` usually resolves to a `.cmd` shim, so the direct child
/// is `cmd` with `powershell`/`muse-bin` grandchildren. Killing only `cmd`
/// orphans them; they keep stdout open, the reader never sees EOF, and the
/// turn never ends (bricking the tab until the orphan exits on its own).
#[cfg(windows)]
pub(crate) fn terminate_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    // taskkill /T terminates descendants first. Hidden like the exec spawn
    // itself so stopping a turn never flashes a console.
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn kill_tree(mut child: Child) {
    if child.try_wait().ok().flatten().is_none() {
        terminate_tree(child.id());
    }
    // Reap the direct child either way; fall back to a plain kill when
    // taskkill itself failed (missing binary, access denied, ...).
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg(not(windows))]
fn kill_tree(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Reap the tab's child after stdout EOF. Returns the exit code, or `None`
/// when `kill_session` already reaped it (a user stop).
fn reap_child(session: &AgentSession) -> Option<Option<i32>> {
    loop {
        {
            let mut guard = session.child.lock().ok()?;
            let child = guard.as_mut()?;
            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    return Some(status.code());
                }
                Err(_) => {
                    return Some(None);
                }
                Ok(None) => {}
            }
        }
        // Keep the handle available to Stop while waiting for process exit.
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn spawn_reader(
    app: AppHandle,
    id: String,
    session: Arc<AgentSession>,
    prompt: StagedPrompt,
    stdout: std::process::ChildStdout,
    stderr: Option<std::process::ChildStderr>,
    memory_mode: crate::memory::Capture,
) {
    // Drain stderr on a side thread so verbose children can never block on
    // a full pipe; the tail is only surfaced when the turn dies silently.
    let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_handle = stderr.map(|err| {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Ok(mut guard) = tail.lock() {
                    guard.push(line);
                    let len = guard.len();
                    if len > STDERR_TAIL_LINES {
                        guard.drain(..len - STDERR_TAIL_LINES);
                    }
                }
            }
        })
    });

    std::thread::spawn(move || {
        let state = app.state::<AgentState>();
        let mut fold = Stream::new(session.provider);
        let mut terminal = None;
        let mut memory_filter = crate::memory::Filter::default();
        let mut final_proposal = None;
        let mut invalid_proposal = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let events = fold.fold_line(&line);
            if let Some(id) = &fold.session_id {
                *session.session_id.lock().unwrap() = id.clone();
            }
            for mut event in events {
                if memory_mode != crate::memory::Capture::Manual {
                    if let AgentEvent::AssistantDelta { text } = &mut event {
                        *text = memory_filter.push(text);
                        if text.is_empty() {
                            continue;
                        }
                    }
                    if let AgentEvent::TurnEnd {
                        text: Some(text), ..
                    } = &mut event
                    {
                        let (clean, proposal, invalid) = crate::memory::clean_final(text);
                        *text = clean;
                        final_proposal = proposal;
                        invalid_proposal |= invalid;
                    }
                }
                if matches!(event, AgentEvent::TurnEnd { .. }) {
                    terminal = Some(event);
                } else if state.sessions.lock().ok().is_some_and(|sessions| {
                    sessions
                        .get(&id)
                        .is_some_and(|current| Arc::ptr_eq(current, &session))
                }) {
                    emit(&app, &id, event);
                }
            }
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.join();
        }
        let exit = reap_child(&session);
        // Headless Antigravity can deny a tool yet still finish successfully.
        // Surface those permission notices so skipped work is visible.
        if session.provider == Provider::Antigravity {
            if let Ok(tail) = stderr_tail.lock() {
                for line in tail.iter().filter(|line| {
                    let line = line.to_ascii_lowercase();
                    line.contains("denied")
                        || line.contains("approval")
                        || line.contains("permission")
                }) {
                    emit(
                        &app,
                        &id,
                        AgentEvent::Notice {
                            text: line.chars().take(2000).collect(),
                        },
                    );
                }
            }
        }
        if terminal.is_none() || exit.is_none() || exit.is_some_and(|code| code != Some(0)) {
            // Reaped by us: exit code decides the status. Already reaped by
            // `kill_session`: the user stopped the turn.
            let (status, reason) = match exit {
                Some(Some(0)) if session.provider == Provider::Muse => ("completed".to_owned(), None),
                Some(Some(0)) => ("failed".to_owned(), Some(format!("{} ended without a completion event. Open Terminal to check its sign-in and setup.", session.provider.label()))),
                Some(code) => {
                    let structured = match &terminal {
                        Some(AgentEvent::TurnEnd { reason: Some(reason), .. }) if !reason.is_empty() => Some(reason.clone()),
                        _ => None,
                    };
                    let tail = stderr_tail
                        .lock()
                        .ok()
                        .map(|g| g.join("\n"))
                        .filter(|t| !t.trim().is_empty());
                    (
                        "failed".to_owned(),
                        Some(structured.or(tail).unwrap_or_else(|| {
                            format!(
                                "{} exited unexpectedly (code {code:?})",
                                session.provider.label()
                            )
                        })),
                    )
                }
                None => ("cancelled".to_owned(), None),
            };
            terminal = Some(AgentEvent::TurnEnd {
                status,
                text: None,
                reason,
            });
        }
        drop(prompt);
        if let Ok(mut prompt) = session.prompt.lock() {
            prompt.take();
        }
        // Completion is visible only after the process is reaped and the
        // next turn can be accepted. Keep registration locked through the
        // terminal event so a competing phone/desktop send cannot overtake it.
        let sessions = state.sessions.lock().unwrap();
        let current = {
            sessions
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &session))
        };
        *session.running.lock().unwrap() = false;
        let mut outcome = None;
        if current {
            let tail = memory_filter.finish();
            if !tail.is_empty() {
                emit(&app, &id, AgentEvent::AssistantDelta { text: tail });
            }
            if !matches!(&terminal,Some(AgentEvent::TurnEnd{status,..}) if status=="completed") {
                // A failed CLI may never have accepted its input. Re-send
                // relevant context next time rather than trusting its history.
                *session.memory.lock().unwrap() = crate::memory::Session::default();
            }
            if matches!(&terminal,Some(AgentEvent::TurnEnd{status,..}) if status=="completed") {
                if memory_filter.invalid || invalid_proposal {
                    emit(
                        &app,
                        &id,
                        AgentEvent::Notice {
                            text: "An incomplete or oversized memory suggestion was skipped."
                                .into(),
                        },
                    );
                }
                if let Some(proposal) = memory_filter.proposal.or(final_proposal) {
                    match app.state::<crate::memory::Store>().capture(
                        &session.workspace.display().to_string(),
                        &proposal,
                        memory_mode,
                        session.provider.label(),
                    ) {
                        Ok(count) if count > 0 => {
                            crate::memory::changed(&app);
                            emit(&app,&id,AgentEvent::Notice{text:format!("{count} memory note(s) added to the vault. Open Memory to view them.")});
                        }
                        Err(error) => emit(
                            &app,
                            &id,
                            AgentEvent::Notice {
                                text: format!("Memory: {error}"),
                            },
                        ),
                        _ => {}
                    }
                }
            }
            if let Some(event) = terminal {
                emit(&app, &id, event.clone());
                if let AgentEvent::TurnEnd { status, .. } = event {
                    outcome = Some(status);
                }
            }
        }
        drop(sessions);
        if let Some(status) = outcome {
            crate::desktop::notify_turn(&app, &session.tab_id, &status);
        }
    });
}

/// Register a tab for headless turns, minting its stable muse session id
/// and binding its workspace directory. Replaces any session already
/// registered under `id`. A bad workspace leaves any existing session
/// untouched.
#[tauri::command]
pub fn agent_new(
    app: AppHandle,
    state: State<AgentState>,
    id: String,
    workspace: Option<String>,
    tab_id: Option<String>,
    provider: Option<Provider>,
    options: Option<RunOptions>,
) -> Result<NewInfo, String> {
    let workspace = resolve_workspace(workspace)?;
    let provider = provider.unwrap_or_default();
    let options = options.unwrap_or_default();
    options.validate(provider)?;
    let session_id = if provider == Provider::Muse {
        uuid::Uuid::new_v4().to_string()
    } else {
        String::new()
    };
    let old = state
        .sessions
        .lock()
        .map_err(|_| "agent state is unavailable".to_string())?
        .insert(
            id.clone(),
            Arc::new(AgentSession {
                tab_id: tab_id.unwrap_or_else(|| id.clone()),
                session_id: Mutex::new(session_id.clone()),
                provider,
                options: Mutex::new(options.clone()),
                memory: Mutex::new(crate::memory::Session::default()),
                workspace: workspace.clone(),
                child: Mutex::new(None),
                running: Mutex::new(false),
                prompt: Mutex::new(None),
            }),
        );
    if let Some(old) = old {
        old.stop();
    }
    app.state::<crate::session_log::SessionLog>()
        .register_provider(&id, workspace.display().to_string(), provider);
    app.state::<crate::session_log::SessionLog>()
        .configure(&id, options);
    crate::remote::changed(&app);
    Ok(NewInfo {
        id,
        session_id,
        workspace: workspace.display().to_string(),
    })
}

pub fn configure_session(
    app: &AppHandle,
    state: &AgentState,
    id: &str,
    options: RunOptions,
    by_tab: bool,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Agent state unavailable.")?;
    let (id, session) = sessions
        .iter()
        .find(|(key, session)| {
            if by_tab {
                session.tab_id == id
            } else {
                key.as_str() == id
            }
        })
        .ok_or("Conversation is still starting. Try again in a moment.")?;
    if *session.running.lock().unwrap() {
        return Err("Wait for the current response or stop it before changing models.".into());
    }
    options.validate(session.provider)?;
    *session.options.lock().unwrap() = options.clone();
    app.state::<crate::session_log::SessionLog>()
        .configure(id, options.clone());
    let _ = app.emit(
        "agent-options",
        serde_json::json!({"tab_id":session.tab_id,"options":options}),
    );
    crate::remote::changed(app);
    Ok(())
}
#[tauri::command]
pub fn agent_configure(
    app: AppHandle,
    state: State<AgentState>,
    tab_id: String,
    options: RunOptions,
) -> Result<(), String> {
    configure_session(&app, &state, &tab_id, options, true)
}

/// Run one prompt against the tab's provider and conversation.
/// When `yolo` is set, `--yolo` disables approval and sandboxing for the turn.
/// Fails while a previous turn is still running; stop it first.
#[tauri::command]
pub fn agent_send(
    app: AppHandle,
    state: State<AgentState>,
    id: String,
    prompt: String,
    yolo: bool,
    remote: Option<bool>,
) -> Result<TurnInfo, String> {
    if prompt.trim().is_empty() {
        return Err("prompt is empty".to_string());
    }
    // Serialize registration with stop/destroy and competing sends until
    // the new child is owned by this session.
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "agent state is unavailable".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "agent session not found; reopen the tab".to_string())?;
    if session.running.lock().map(|r| *r).unwrap_or(false) {
        return Err("a turn is already running — stop it first".to_string());
    }
    let session = Arc::clone(session);
    let provider = session.provider;
    let cli_path = provider.resolve().ok_or_else(|| provider.missing())?;
    let session_id = session.session_id.lock().unwrap().clone();
    let workspace = &session.workspace;
    // Prompt via file so quoting/newlines can never corrupt argv.
    let turn_id = uuid::Uuid::new_v4().to_string();
    let staged = StagedPrompt(prompt_file(&turn_id));
    let file = &staged.0;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to stage prompt: {e}"))?;
    }
    let mut next_memory = session.memory.lock().unwrap().clone();
    let (prepared, memory_usage, memory_mode) = match app.state::<crate::memory::Store>().prepare(
        &workspace.display().to_string(),
        &prompt,
        &mut next_memory,
    ) {
        Ok(value) => value,
        Err(error) => {
            emit(
                &app,
                &id,
                AgentEvent::Notice {
                    text: format!("Memory unavailable: {error}. Sending without memory."),
                },
            );
            (
                prompt.clone(),
                crate::memory::Usage::default(),
                crate::memory::Capture::Manual,
            )
        }
    };
    std::fs::write(file, provider.input(&prepared))
        .map_err(|e| format!("failed to stage prompt: {e}"))?;

    let options = session.options.lock().unwrap().clone();
    let mut cmd = providers::exec_command(
        provider,
        &cli_path,
        &session_id,
        workspace,
        file,
        yolo,
        &options,
    )?;
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch `{}`: {e}", cli_path.display()))?;

    let mut child = child;
    *session.memory.lock().unwrap() = next_memory;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        "could not capture agent output".to_string()
    })?;
    let stderr = child.stderr.take();
    {
        *session
            .prompt
            .lock()
            .map_err(|_| "agent state is unavailable".to_string())? = Some(file.clone());
        *session
            .running
            .lock()
            .map_err(|_| "agent state is unavailable".to_string())? = true;
        // The child handle stays here so `agent_stop` can kill it; the
        // reader thread reaps it after EOF.
        *session
            .child
            .lock()
            .map_err(|_| "agent state is unavailable".to_string())? = Some(child);
    }
    drop(sessions);
    emit(
        &app,
        &id,
        AgentEvent::TurnStart {
            prompt,
            remote: remote.unwrap_or(false),
        },
    );
    emit(
        &app,
        &id,
        AgentEvent::MemoryContext {
            titles: memory_usage.titles,
            bytes: memory_usage.bytes,
            budget_bytes: memory_usage.budget_bytes,
        },
    );
    spawn_reader(
        app,
        id.clone(),
        session,
        staged,
        stdout,
        stderr,
        memory_mode,
    );
    Ok(TurnInfo { id, turn_id })
}

/// Stop the tab's running turn, if any. Always succeeds.
#[tauri::command]
pub fn agent_stop(state: State<AgentState>, id: String) -> Result<(), String> {
    kill_session(&state, &id);
    Ok(())
}

/// Drop the tab's agent session, stopping any running turn and removing
/// its staged prompt. The muse-side session log is left on disk.
#[tauri::command]
pub fn agent_destroy(app: AppHandle, state: State<AgentState>, id: String) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(&id));
    if let Some(session) = session {
        session.stop();
    }
    app.state::<crate::session_log::SessionLog>().remove(&id);
    crate::remote::changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{home_dir, resolve_workspace, safe_fragment};
    fn build_exec_command(path: &std::path::Path, yolo: bool) -> std::process::Command {
        crate::providers::exec_command(
            crate::providers::Provider::Muse,
            path,
            "session",
            std::path::Path::new("."),
            std::path::Path::new("prompt.txt"),
            yolo,
            &crate::provider_models::RunOptions::default(),
        )
        .unwrap()
    }
    use std::path::Path;

    #[test]
    fn tab_id_is_sanitized_for_filenames() {
        assert_eq!(safe_fragment("abc-123_X"), "abc-123_X");
        assert_eq!(safe_fragment("a/b\\c:d"), "a_b_c_d");
    }

    #[test]
    fn workspace_defaults_to_home() {
        assert_eq!(resolve_workspace(None).unwrap(), home_dir());
        assert_eq!(resolve_workspace(Some(String::new())).unwrap(), home_dir());
        assert_eq!(
            resolve_workspace(Some("   ".to_owned())).unwrap(),
            home_dir()
        );
    }

    #[test]
    fn workspace_accepts_existing_dirs_only() {
        let tmp = std::env::temp_dir();
        assert_eq!(
            resolve_workspace(Some(tmp.display().to_string())).unwrap(),
            tmp
        );
        let missing = tmp.join(format!(
            "velum-code-no-such-workspace-{}",
            std::process::id()
        ));
        assert!(resolve_workspace(Some(missing.display().to_string())).is_err());
        let probe = tmp.join(format!("velum-code-ws-probe-{}", std::process::id()));
        std::fs::write(&probe, b"probe").unwrap();
        assert!(resolve_workspace(Some(probe.display().to_string())).is_err());
        let _ = std::fs::remove_file(&probe);
    }

    #[test]
    fn exec_argv_starts_with_exec_json() {
        let cmd = build_exec_command(Path::new("muse"), false);
        let args: Vec<_> = cmd.get_args().collect();
        assert!(args.len() >= 2);
        assert_eq!(args[0], std::ffi::OsStr::new("exec"));
        assert_eq!(args[1], std::ffi::OsStr::new("--json"));
    }

    fn has_yolo(cmd: &std::process::Command) -> bool {
        cmd.get_args().any(|a| a == "--yolo")
    }

    #[test]
    fn yolo_flag_reaches_exec_argv() {
        let plain = build_exec_command(Path::new("muse"), true);
        assert!(has_yolo(&plain));
        let plain = build_exec_command(Path::new("muse"), false);
        assert!(!has_yolo(&plain));
        // Script shims wrap in an interpreter; the flag must survive that too.
        let shim = build_exec_command(Path::new("muse.cmd"), true);
        assert!(has_yolo(&shim));
        let shim = build_exec_command(Path::new("muse.cmd"), false);
        assert!(!has_yolo(&shim));
    }

    /// Stopping a turn must terminate the whole shim chain (`cmd` ->
    /// grandchild), not just the direct child, or survivors hold stdout open
    /// and the turn never ends. Spawns a real `cmd /C ping` chain, kills it,
    /// and asserts our pings are gone while pre-existing ones survive.
    /// Flake note: concurrent `ping.exe` churn on the machine inside the
    /// ~3s test window could confuse the baseline; pings are rare enough
    /// that this is accepted (the poll window right after spawn is ~300ms).
    #[cfg(windows)]
    #[test]
    fn kill_tree_terminates_descendants() {
        use std::collections::HashSet;
        use std::process::{Command, Stdio};

        fn ping_pids() -> HashSet<u32> {
            let out = Command::new("tasklist")
                .args(["/FI", "IMAGENAME eq ping.exe", "/FO", "CSV", "/NH"])
                .stdin(Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(Stdio::null())
                .output();
            let mut pids = HashSet::new();
            if let Ok(out) = out {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    // "ping.exe","1234","Console","1","8,192 K"
                    if let Some(pid) = line.split("\",\"").nth(1) {
                        if let Ok(pid) = pid.trim_matches('"').parse::<u32>() {
                            pids.insert(pid);
                        }
                    }
                }
            }
            pids
        }

        let before = ping_pids();
        let child = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn shim chain");
        // Catch the grandchild the moment it appears (tight window keeps
        // foreign pings out of our set).
        let mut ours = HashSet::new();
        for _ in 0..30 {
            ours = ping_pids().difference(&before).copied().collect();
            if !ours.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(!ours.is_empty(), "grandchild ping never appeared");
        super::kill_tree(child);
        std::thread::sleep(std::time::Duration::from_secs(2));
        let after = ping_pids();
        assert!(
            ours.iter().all(|p| !after.contains(p)),
            "grandchild survived tree kill: {after:?}"
        );
        assert!(
            before.iter().all(|p| after.contains(p)),
            "pre-existing ping reaped: {after:?}"
        );
    }
}
