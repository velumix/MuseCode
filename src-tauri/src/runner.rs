//! One provider process per turn, bound to its tab and workspace.
//! Provider streams share one event vocabulary for desktop, phone and notifications.
//! Resume IDs come from the selected CLI; stderr is drained concurrently.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::AgentEvent;
use crate::provider_events::Stream;
use crate::provider_models::RunOptions;
use crate::providers::{self, Provider};
use crate::pty::home_dir;

/// Last stderr lines retained for failure diagnosis.
const STDERR_TAIL_LINES: usize = 30;

pub struct AgentSession {
    registration: u64,
    access: Mutex<AccessState>,
    bot_id: Option<String>,
    bot_identity: Mutex<Option<crate::bots::Identity>>,
    task_id: Option<String>,
    shared_memory: Mutex<crate::memory::Session>,
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

struct AccessState {
    fresh_session_pending: bool,
    requested: bool,
    applied: Option<bool>,
    revision: u64,
    host: Option<crate::workspace_access::Report>,
    agent: crate::workspace_access::Report,
    restrictions: serde_json::Value,
}

/// If staging or launching fails, publish untested evidence and cleanup results
/// instead of leaving the diagnostics panel stuck on a running probe.
struct PendingProbe {
    probe: Option<crate::workspace_access::Probe>,
    session: Arc<AgentSession>,
}
impl Drop for PendingProbe {
    fn drop(&mut self) {
        if let Some(probe) = self.probe.as_mut() {
            self.session.access.lock().unwrap().agent = probe.finish();
        }
    }
}
impl AccessState {
    fn new(workspace: &std::path::Path, provider: Provider, applied: Option<bool>) -> Self {
        Self {
            fresh_session_pending: false,
            requested: false,
            applied,
            revision: 0,
            host: None,
            agent: crate::workspace_access::Report::untested(
                workspace,
                format!("{} agent tools", provider.label()),
                false,
                0,
            ),
            restrictions: serde_json::json!({"status":"untested","detail":"No effective provider metadata observed in this process."}),
        }
    }
    fn change(&mut self, yolo: bool, has_resume: bool) -> bool {
        let reset = self.requested != yolo
            || self.applied.is_some_and(|mode| mode != yolo)
            || (has_resume && self.applied.is_none() && !self.fresh_session_pending);
        if reset {
            self.revision += 1;
            self.agent.invalidate(self.revision, yolo);
            self.host = None;
            self.restrictions = serde_json::json!({"status":"untested","detail":"Permission mode changed; a new provider session is required."});
            self.applied = None;
            self.fresh_session_pending = true;
        }
        self.requested = yolo;
        reset
    }
    fn value(&self, sanitized: bool) -> serde_json::Value {
        let report = |r: &crate::workspace_access::Report| {
            if sanitized {
                crate::workspace_access::sanitized(r)
            } else {
                serde_json::to_value(r).unwrap()
            }
        };
        serde_json::json!({"host":self.host.as_ref().map(report),"agent":report(&self.agent),
            "permissions":{"requested_mode":crate::workspace_access::mode(self.requested),"launched_mode":self.applied.map(crate::workspace_access::mode),"revision":self.revision,"effective":self.restrictions,
            "session_transition":"Mode changes start a fresh provider conversation. The visible transcript remains; previous provider context is not replayed."}})
    }
    fn observe_session(&mut self, previous: &str, current: &str) -> bool {
        if previous.is_empty() || previous == current {
            return false;
        }
        self.revision += 1;
        self.agent.invalidate(self.revision, self.requested);
        self.host = None;
        self.restrictions = serde_json::json!({"status":"untested","detail":"Provider session changed; earlier access evidence was invalidated."});
        true
    }
}

#[derive(Default)]
pub struct AgentState {
    sessions: Mutex<HashMap<String, Arc<AgentSession>>>,
    next_registration: AtomicU64,
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
    pub fn record_host(
        &self,
        id: &str,
        workspace: &std::path::Path,
        report: crate::workspace_access::Report,
    ) {
        if let Some(session) = self.sessions.lock().unwrap().get(id) {
            if session.workspace == workspace {
                session.access.lock().unwrap().host = Some(report);
            }
        }
    }
    pub fn access(
        &self,
        id: &str,
        workspace: &std::path::Path,
        sanitized: bool,
    ) -> Option<serde_json::Value> {
        let session = self.sessions.lock().ok()?.get(id)?.clone();
        if std::fs::canonicalize(&session.workspace).ok()?
            != std::fs::canonicalize(workspace).ok()?
        {
            return None;
        }
        let value = session.access.lock().ok()?.value(sanitized);
        Some(value)
    }
    /// Provider and requested permission mode for a session bound to this
    /// workspace. Diagnostics guidance must reflect the actual session, never
    /// a hardcoded provider or mode.
    pub fn session_context(
        &self,
        id: &str,
        workspace: &std::path::Path,
    ) -> Option<(Provider, bool)> {
        let session = self.sessions.lock().ok()?.get(id)?.clone();
        if std::fs::canonicalize(&session.workspace).ok()?
            != std::fs::canonicalize(workspace).ok()?
        {
            return None;
        }
        let requested = session.access.lock().ok()?.requested;
        Some((session.provider, requested))
    }
    pub fn stop_id(&self, id: &str) {
        let session = self.sessions.lock().ok().and_then(|s| s.get(id).cloned());
        if let Some(s) = session {
            s.stop();
        }
    }
    pub fn workspace_busy(&self, workspace: &str) -> bool {
        let workspace = std::fs::canonicalize(workspace).ok();
        self.sessions.lock().unwrap().values().any(|s| {
            *s.running.lock().unwrap() && std::fs::canonicalize(&s.workspace).ok() == workspace
        })
    }
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
    pub bot: Option<crate::bots::Identity>,
    pub id: String,
    pub session_id: String,
    pub workspace: String,
    pub workspace_notice: Option<String>,
    pub restored: Vec<AgentEvent>,
    pub truncated: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct TurnInfo {
    pub id: String,
    pub turn_id: String,
}

fn emit(app: &AppHandle, id: &str, event: AgentEvent) {
    app.state::<crate::session_log::SessionLog>()
        .record(id, &event);
    app.state::<crate::history::HistoryState>().mark(id);
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
            let canonical = std::fs::canonicalize(&path)
                .map_err(|e| format!("Cannot resolve the selected project: {e}"))?;
            // Keep Windows paths usable in CLI prompts and PowerShell LiteralPath.
            #[cfg(windows)]
            let canonical = {
                let text = canonical.display().to_string();
                if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
                    std::path::PathBuf::from(format!(r"\\{unc}"))
                } else {
                    std::path::PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
                }
            };
            Ok(canonical)
        }
    }
}

#[tauri::command]
pub fn agent_validate_workspace(workspace: Option<String>) -> Result<String, String> {
    let path = resolve_workspace(workspace)?;
    if !crate::app_context::readable(&path) {
        return Err(
            "Velum cannot list this folder. Choose another project or check Windows folder access."
                .into(),
        );
    }
    Ok(path.display().to_string())
}

fn headless_permission_denied(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    text.contains("permission")
        && (text.contains("auto-denied")
            || text.contains("soft-denied")
            || (text.contains("headless") && text.contains("cannot prompt")))
}

fn mark_permission_blocked(terminal: &mut Option<AgentEvent>, denied: bool) {
    if let Some(AgentEvent::TurnEnd { status, reason, .. }) = terminal {
        if denied && status != "cancelled" {
            *status = "blocked".into();
            *reason = Some("Antigravity blocked a tool because headless mode cannot ask for permission. On your desktop, open Terminal in an Antigravity tab and enter /permissions, or add a scoped rule such as \"command(...)\" under permissions.allow in ~/.gemini/antigravity-cli/settings.json. Allow only the command needed, then retry. Scheduled work is paused; partial output is not a completed task.".into());
        }
    }
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

struct TurnContext {
    probe: Option<crate::workspace_access::Probe>,
    memory_mode: crate::memory::Capture,
    action_context: Option<crate::bot_actions::Context>,
    started: std::time::Instant,
    started_at: i64,
    usage_session: String,
    usage_baseline: Option<crate::provider_usage::TurnUsage>,
}
fn spawn_reader(
    app: AppHandle,
    id: String,
    session: Arc<AgentSession>,
    prompt: StagedPrompt,
    stdout: std::process::ChildStdout,
    stderr: Option<std::process::ChildStderr>,
    context: TurnContext,
) {
    let TurnContext {
        mut probe,
        memory_mode,
        action_context,
        started,
        started_at,
        usage_session,
        usage_baseline,
    } = context;
    // Drain stderr on a side thread so verbose children can never block on
    // a full pipe; the tail is only surfaced when the turn dies silently.
    let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let probe_errors: Arc<Mutex<HashMap<&'static str, crate::workspace_access::OperationFailure>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let probe_id = probe.as_ref().map(|p| p.id.clone());
    let permission_denied = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stderr_handle = stderr.map(|err| {
        let tail = Arc::clone(&stderr_tail);
        let denied = Arc::clone(&permission_denied);
        let errors = Arc::clone(&probe_errors);
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Some(id) = &probe_id {
                    for error in crate::workspace_access::error_evidence(id, &line) {
                        errors.lock().unwrap().insert(error.operation, error);
                    }
                }
                if headless_permission_denied(&line) {
                    denied.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                if let Ok(mut guard) = tail.lock() {
                    guard.push(line.chars().take(4000).collect());
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
        let mut turn_usage = None;
        let fresh_provider_session = usage_session.is_empty();
        // Exec does not stream context counters on stdout. Watch only this
        // thread's numeric metadata, and join before publishing completion.
        let (usage_stop, usage_receiver) = std::sync::mpsc::channel::<u64>();
        let usage_handle = (session.provider == Provider::Codex).then(|| {
            let app = app.clone();
            let session = Arc::clone(&session);
            let id = id.clone();
            std::thread::spawn(move || {
                let mut last = None;
                let mut last_turn = None;
                let mut known_session = usage_session;
                let mut baseline = usage_baseline;
                let mut path = None;
                loop {
                    let completed_ms =
                        match usage_receiver.recv_timeout(std::time::Duration::from_secs(1)) {
                            Ok(elapsed) => Some(elapsed),
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => None,
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                Some(started.elapsed().as_millis().min(u64::MAX as u128) as u64)
                            }
                        };
                    let resume = session.session_id.lock().unwrap().clone();
                    if known_session != resume {
                        known_session = resume;
                        path = None;
                        last = None;
                        last_turn = None;
                        baseline = Some(crate::provider_usage::TurnUsage::zero());
                    }
                    if path.is_none() && !known_session.is_empty() {
                        path = crate::provider_usage::codex_session_file(&known_session);
                    }
                    let snapshot = path
                        .as_deref()
                        .and_then(|p| crate::provider_usage::codex_usage(p, started_at));
                    if let Some(snapshot) = snapshot.filter(|s| last.as_ref() != Some(&s.context)) {
                        let elapsed_ms = completed_ms.unwrap_or_else(|| {
                            started.elapsed().as_millis().min(u64::MAX as u128) as u64
                        });
                        let turn = snapshot
                            .total
                            .as_ref()
                            .zip(baseline.as_ref())
                            .map(|(total, baseline)| total.since(baseline, elapsed_ms));
                        let state = app.state::<AgentState>();
                        let sessions = state.sessions.lock().unwrap();
                        if sessions.get(&id).is_some_and(|s| Arc::ptr_eq(s, &session)) {
                            emit(
                                &app,
                                &id,
                                AgentEvent::Usage {
                                    context: Some(snapshot.context.clone()),
                                    turn: turn.clone(),
                                },
                            );
                        }
                        last = Some(snapshot.context);
                        if turn.is_some() {
                            last_turn = turn;
                        }
                    }
                    if let Some(elapsed_ms) = completed_ms {
                        if let Some(turn) = last_turn.as_mut() {
                            turn.elapsed_ms = Some(elapsed_ms);
                            let state = app.state::<AgentState>();
                            let sessions = state.sessions.lock().unwrap();
                            if sessions.get(&id).is_some_and(|s| Arc::ptr_eq(s, &session)) {
                                emit(
                                    &app,
                                    &id,
                                    AgentEvent::Usage {
                                        context: None,
                                        turn: Some(turn.clone()),
                                    },
                                );
                            }
                        }
                        return last_turn;
                    }
                }
            })
        });
        let mut terminal = None;
        let mut memory_filter = crate::memory::Filter::default();
        let mut final_proposal = None;
        let mut invalid_proposal = false;
        let mut bot_output = crate::bot_actions::Output::default();
        let mut final_action = None;
        let mut invalid_action = false;
        let mut answer = String::new();
        let mut action_error = None;
        let mut action_report = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(probe) = probe.as_mut() {
                probe.observe_line(session.provider, &line);
            }
            let events = fold.fold_line(&line);
            if let Some(resume_id) = &fold.session_id {
                let mut previous = session.session_id.lock().unwrap();
                let mut access = session.access.lock().unwrap();
                if access.observe_session(&previous, resume_id) {
                    if let Some(probe) = probe.as_mut() {
                        probe.report.revision = access.revision;
                        access.agent = probe.report.clone();
                    }
                }
                *previous = resume_id.clone();
                drop(access);
                drop(previous);
                app.state::<crate::history::HistoryState>()
                    .resume_id(&id, resume_id);
            }
            for mut event in events {
                if let AgentEvent::Usage {
                    turn: Some(usage), ..
                } = &mut event
                {
                    // For resumed Codex threads, normalize against the saved
                    // session counters. This also works with CLI versions
                    // whose completion event contains cumulative totals.
                    if session.provider == Provider::Codex && !fresh_provider_session {
                        continue;
                    }
                    usage.elapsed_ms =
                        Some(started.elapsed().as_millis().min(u64::MAX as u128) as u64);
                    turn_usage = Some(usage.clone());
                }
                if matches!(&event, AgentEvent::ToolEnd { reason: Some(reason), .. } | AgentEvent::TurnEnd { reason: Some(reason), .. } if headless_permission_denied(reason))
                {
                    permission_denied.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                if action_context.is_some() {
                    if let AgentEvent::AssistantDelta { text } = &mut event {
                        *text = bot_output.push(text);
                        if text.is_empty() {
                            continue;
                        }
                    }
                    if let AgentEvent::TurnEnd {
                        text: Some(text), ..
                    } = &mut event
                    {
                        let mut output = crate::bot_actions::Output::default();
                        let mut clean = output.push(text);
                        clean.push_str(&output.finish());
                        *text = clean;
                        final_action = output.action;
                        final_proposal = output.memory;
                        invalid_action |= output.invalid;
                    }
                } else if memory_mode != crate::memory::Capture::Manual {
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
                match &event {
                    AgentEvent::AssistantDelta { text } => {
                        if answer.len() < 16000 {
                            answer.extend(text.chars().take(16000 - answer.len()));
                        }
                    }
                    AgentEvent::TurnEnd {
                        text: Some(text), ..
                    } if !text.is_empty() => answer = text.chars().take(16000).collect(),
                    _ => {}
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
        let turn_elapsed = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let _ = usage_stop.send(turn_elapsed);
        if let Some(handle) = usage_handle {
            if let Ok(Some(usage)) = handle.join() {
                turn_usage = Some(usage);
            }
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.join();
        }
        let headless_denial = session.provider == Provider::Antigravity
            && permission_denied.load(std::sync::atomic::Ordering::Relaxed);
        let policy_tool_events = if headless_denial {
            fold.permission_denied()
        } else {
            vec![]
        };
        let probe_report = if let Some(mut probe) = probe {
            if let Ok(errors) = probe_errors.lock() {
                for error in errors.values() {
                    probe.record_failure(error);
                }
            }
            if headless_denial {
                probe.permission_denied();
            }
            Some(probe.finish())
        } else {
            None
        };
        let restrictions = if session.provider == Provider::Codex {
            let resume = session.session_id.lock().unwrap().clone();
            Some(crate::workspace_access::codex_restrictions(&resume))
        } else {
            None
        };
        let exit = reap_child(&session);
        if terminal.is_none() || exit.is_none() || exit.is_some_and(|code| code != Some(0)) {
            // Reaped by us: exit code decides the status. Already reaped by
            // `kill_session`: the user stopped the turn.
            let (status, reason) = match exit {
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
        if session.provider == Provider::Antigravity {
            mark_permission_blocked(
                &mut terminal,
                permission_denied.load(std::sync::atomic::Ordering::Relaxed),
            );
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
        {
            let mut access = session.access.lock().unwrap();
            if let Some(report) = probe_report {
                access.agent = report;
            }
            if let Some(restrictions) = restrictions {
                access.restrictions = restrictions;
            }
        }
        let mut outcome = None;
        if current {
            if turn_usage.is_none() {
                emit(
                    &app,
                    &id,
                    AgentEvent::Usage {
                        context: None,
                        turn: Some(crate::provider_usage::TurnUsage {
                            elapsed_ms: Some(turn_elapsed),
                            ..Default::default()
                        }),
                    },
                );
            }
            let tail = if action_context.is_some() {
                bot_output.finish()
            } else {
                memory_filter.finish()
            };
            if !tail.is_empty() {
                answer.push_str(&tail);
                emit(&app, &id, AgentEvent::AssistantDelta { text: tail });
            }
            if !matches!(&terminal,Some(AgentEvent::TurnEnd{status,..}) if status=="completed") {
                // A failed CLI may never have accepted its input. Re-send
                // relevant context next time rather than trusting its history.
                *session.memory.lock().unwrap() = crate::memory::Session::default();
                *session.shared_memory.lock().unwrap() = crate::memory::Session::default();
            }
            if matches!(&terminal,Some(AgentEvent::TurnEnd{status,..}) if status=="completed") {
                if memory_filter.invalid || invalid_proposal || bot_output.invalid {
                    emit(
                        &app,
                        &id,
                        AgentEvent::Notice {
                            text: "An incomplete or oversized memory suggestion was skipped."
                                .into(),
                        },
                    );
                }
                let valid_memory =
                    !(memory_filter.invalid || invalid_proposal || bot_output.invalid);
                if let Some(proposal) = bot_output
                    .memory
                    .or(memory_filter.proposal)
                    .or(final_proposal)
                    .filter(|_| valid_memory)
                {
                    let private = session
                        .bot_id
                        .as_ref()
                        .map(|id| app.state::<crate::bots::Store>().memory(id))
                        .transpose();
                    let capture = private.and_then(|private| {
                        let global = app.state::<crate::memory::Store>();
                        private.as_deref().unwrap_or(&global).capture(
                            &session.workspace.display().to_string(),
                            &proposal,
                            memory_mode,
                            session.provider.label(),
                        )
                    });
                    match capture {
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
                if let Some(context) = &action_context {
                    if invalid_action || bot_output.invalid {
                        let text="Incomplete or duplicate bot actions were skipped. The board was not changed.".to_owned();
                        action_error = Some(text.clone());
                        emit(&app, &id, AgentEvent::Notice { text });
                    } else if let Some(action) = bot_output.action.or(final_action) {
                        let result = crate::bot_actions::apply(
                            &app,
                            &session.workspace.display().to_string(),
                            &id,
                            context,
                            &action,
                        );
                        let text = match result {
                            Ok(text) => {
                                action_report = Some(text.clone());
                                text
                            }
                            Err(e) => {
                                let text = format!("Bot actions: {e}");
                                action_error = Some(text.clone());
                                text
                            }
                        };
                        emit(&app, &id, AgentEvent::Notice { text });
                    }
                }
            }
            for event in policy_tool_events {
                emit(&app, &id, event);
            }
            if let Some(event) = terminal {
                emit(&app, &id, event.clone());
                if let AgentEvent::TurnEnd { status, reason, .. } = event {
                    outcome = Some((status, reason));
                }
            }
        }
        drop(sessions);
        if let Some((status, reason)) = outcome {
            crate::desktop::notify_turn(&app, &session.tab_id, &status);
            if let Err(error) = crate::automation::finish(
                &app,
                &id,
                if action_error.is_some() {
                    "review"
                } else {
                    &status
                },
                &answer,
                action_error.or(action_report).or(reason),
            ) {
                emit(
                    &app,
                    &id,
                    AgentEvent::Notice {
                        text: format!("Could not finish the scheduled run: {error}"),
                    },
                );
            }
        }
    });
}

/// Register a tab for headless turns, minting its stable muse session id
/// and binding its workspace directory. Replaces any session already
/// registered under `id`. A bad workspace leaves any existing session
/// untouched.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Preserve the named IPC arguments used by existing desktops.
pub fn agent_new(
    app: AppHandle,
    id: String,
    workspace: Option<String>,
    tab_id: Option<String>,
    provider: Option<Provider>,
    options: Option<RunOptions>,
    resume: Option<bool>,
    bot_id: Option<String>,
    task_id: Option<String>,
) -> Result<NewInfo, String> {
    let state = app.state::<AgentState>();
    let workspace = resolve_workspace(workspace)?;
    let provider = provider.unwrap_or_default();
    let bot = bot_id
        .as_ref()
        .map(|id| app.state::<crate::bots::Store>().get(id))
        .transpose()?;
    let options = options.unwrap_or_default();
    options.validate(provider)?;
    let tab_id = tab_id.unwrap_or_else(|| id.clone());
    let history = app.state::<crate::history::HistoryState>();
    let saved = if resume.unwrap_or(false) {
        history
            .load(&tab_id, &workspace.display().to_string(), provider)?
            .filter(|saved| saved.bot_id == bot_id)
    } else {
        None
    };
    let session_id = if let Some(saved) = &saved {
        saved.session_id.clone()
    } else if provider == Provider::Muse {
        uuid::Uuid::new_v4().to_string()
    } else {
        String::new()
    };
    let restored_mode = saved.as_ref().and_then(|s| s.permission_mode);
    let mut access = AccessState::new(&workspace, provider, restored_mode);
    // Muse allocates its ID before launching. A new ID is not a resumed
    // conversation with an unknown legacy permission mode.
    access.fresh_session_pending = saved.is_none();
    let old = state
        .sessions
        .lock()
        .map_err(|_| "agent state is unavailable".to_string())?
        .insert(
            id.clone(),
            Arc::new(AgentSession {
                registration: state.next_registration.fetch_add(1, Ordering::Relaxed),
                access: Mutex::new(access),
                bot_id: bot_id.clone(),
                bot_identity: Mutex::new(bot.as_ref().map(|p| p.identity())),
                task_id,
                shared_memory: Mutex::new(crate::memory::Session::default()),
                tab_id: tab_id.clone(),
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
    let truncated = saved.as_ref().is_some_and(|saved| saved.truncated);
    let mut restored = saved.map(|saved| saved.events).unwrap_or_default();
    if session_id.is_empty() {
        restored.push(AgentEvent::UsageReset);
    }
    for event in &restored {
        app.state::<crate::session_log::SessionLog>()
            .record(&id, event);
    }
    history.bind(
        &id,
        tab_id,
        workspace.display().to_string(),
        provider,
        session_id.clone(),
    );
    history.bind_bot(&id, bot_id);
    if let Some(mode) = restored_mode {
        history.permission_mode(&id, mode);
    }
    if let Some(profile) = &bot {
        emit(
            &app,
            &id,
            AgentEvent::BotIdentity {
                bot: profile.identity(),
            },
        );
    }
    if truncated {
        history.mark_truncated(&id);
    }
    crate::remote::changed(&app);
    Ok(NewInfo {
        bot: bot.map(|p| p.identity()),
        id,
        session_id,
        workspace: workspace.display().to_string(),
        workspace_notice: crate::workspace_access::project_required(&workspace, provider, false)
            .then(|| crate::workspace_access::PROFILE_ROOT_GUIDANCE.into()),
        restored,
        truncated,
    })
}

fn configuration_target<'a>(
    sessions: &'a HashMap<String, Arc<AgentSession>>,
    id: &str,
    by_tab: bool,
) -> Option<(&'a String, &'a Arc<AgentSession>)> {
    // A WebView reload can leave an older native session behind. Desktop model
    // controls belong to the most recently registered owner of that tab. Phone
    // controls carry an exact native ID and must continue targeting that ID.
    sessions
        .iter()
        .filter(|(key, session)| {
            if by_tab {
                session.tab_id == id
            } else {
                key.as_str() == id
            }
        })
        .max_by_key(|(_, session)| session.registration)
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
    let (id, session) = configuration_target(&sessions, id, by_tab)
        .ok_or("Conversation is still starting. Try again in a moment.")?;
    if *session.running.lock().unwrap() {
        return Err("Wait for the current response or stop it before changing models.".into());
    }
    options.validate(session.provider)?;
    let model_changed = {
        let mut previous = session.options.lock().unwrap();
        let changed = previous.model != options.model;
        *previous = options.clone();
        changed
    };
    if model_changed {
        emit(app, id, AgentEvent::UsageReset);
    }
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
    send_inner(app, state, id, prompt, yolo, remote, false)
}

#[tauri::command]
pub fn agent_check_access(
    app: AppHandle,
    state: State<AgentState>,
    id: String,
    yolo: bool,
) -> Result<TurnInfo, String> {
    send_inner(
        app,
        state,
        id,
        "Check workspace access (Velum diagnostics)".into(),
        yolo,
        None,
        true,
    )
}

fn change_permissions(app: &AppHandle, id: &str, session: &AgentSession, yolo: bool) -> bool {
    let mut resume = session.session_id.lock().unwrap();
    let mut access = session.access.lock().unwrap();
    let changed = access.change(yolo, !resume.is_empty());
    if changed {
        *resume = if session.provider == Provider::Muse {
            uuid::Uuid::new_v4().to_string()
        } else {
            String::new()
        };
        *session.memory.lock().unwrap() = Default::default();
        *session.shared_memory.lock().unwrap() = Default::default();
        app.state::<crate::history::HistoryState>()
            .resume_id(id, &resume);
        emit(app, id, AgentEvent::UsageReset);
        emit(app, id, AgentEvent::Notice { text: format!("Permission mode is now {}. The next turn starts a fresh provider conversation; the visible transcript is retained, but previous provider context is not replayed. Workspace checks were invalidated. Run Test agent access to verify this mode.", crate::workspace_access::mode(yolo)) });
    }
    let _ = app.emit(
        "agent-permissions",
        serde_json::json!({"tab_id":session.tab_id,"yolo":yolo}),
    );
    changed
}

#[tauri::command]
pub fn agent_set_permissions(
    app: AppHandle,
    state: State<AgentState>,
    id: String,
    yolo: bool,
) -> Result<serde_json::Value, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Agent state unavailable.")?;
    let session = sessions.get(&id).ok_or("Conversation is still starting.")?;
    if *session.running.lock().unwrap() {
        return Err("Wait for the current turn or stop it before changing permissions.".into());
    }
    let changed = change_permissions(&app, &id, session, yolo);
    Ok(serde_json::json!({"yolo":yolo,"new_session":changed,"checks_invalidated":changed}))
}

#[allow(clippy::too_many_arguments)]
fn send_inner(
    app: AppHandle,
    state: State<AgentState>,
    id: String,
    prompt: String,
    yolo: bool,
    remote: Option<bool>,
    check_access: bool,
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
    let managed = app.state::<crate::automation::Store>().managed(&id);
    if sessions.iter().any(|(other_id, other)| {
        other_id != &id
            && *other.running.lock().unwrap()
            && std::fs::canonicalize(&other.workspace).ok()
                == std::fs::canonicalize(&session.workspace).ok()
            && (managed || app.state::<crate::automation::Store>().managed(other_id))
    }) {
        return Err("Scheduled work and chat cannot run together in the same workspace. Wait for the current turn or stop it first.".into());
    }
    let bot = session
        .bot_id
        .as_ref()
        .map(|bot| app.state::<crate::bots::Store>().get(bot))
        .transpose()?;
    if bot.as_ref().is_some_and(|bot| !bot.enabled) {
        return Err("This bot is disabled. Enable it from Bots before starting work.".into());
    }
    let provider = session.provider;
    // Apply the requested mode even when workspace validation prevents launch.
    // A rejected Standard turn must not leave stale unrestricted diagnostics.
    change_permissions(&app, &id, &session, yolo);
    if !check_access
        && crate::workspace_access::project_required(&session.workspace, provider, yolo)
    {
        return Err(crate::workspace_access::PROFILE_ROOT_GUIDANCE.into());
    }
    let cli_path = provider.resolve().ok_or_else(|| provider.missing())?;
    let session_id = session.session_id.lock().unwrap().clone();
    let workspace = &session.workspace;
    let probe = if check_access {
        let mut access = session.access.lock().unwrap();
        access.host = Some(crate::workspace_access::host_probe(workspace, true));
        let mut probe = crate::workspace_access::Probe::prepare(
            workspace,
            format!("{} agent tools", provider.label()),
            yolo,
            access.revision,
        );
        probe.report.running = true;
        access.agent = probe.report.clone();
        Some(probe)
    } else {
        None
    };
    let mut pending = PendingProbe {
        probe,
        session: Arc::clone(&session),
    };
    // Prompt via file so quoting/newlines can never corrupt argv.
    let turn_id = uuid::Uuid::new_v4().to_string();
    let staged = StagedPrompt(prompt_file(&turn_id));
    let file = &staged.0;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to stage prompt: {e}"))?;
    }
    let mut next_memory = session.memory.lock().unwrap().clone();
    let mut next_shared = session.shared_memory.lock().unwrap().clone();
    let memory_result = if let Some(probe) = &pending.probe {
        Ok((
            probe.prompt(provider),
            crate::memory::Usage::default(),
            crate::memory::Capture::Manual,
        ))
    } else if let Some(bot) = &bot {
        (|| {
            let global = app.state::<crate::memory::Store>();
            let shared_budget = if bot.shared_memory {
                bot.memory_budget / 3
            } else {
                0
            };
            let (shared, shared_usage, _) = global.prepare_limited(
                &workspace.display().to_string(),
                &prompt,
                &mut next_shared,
                Some(shared_budget),
                false,
            )?;
            let private = app.state::<crate::bots::Store>().memory(&bot.id)?;
            let (own, mut usage, mode) = private.prepare_limited(
                &workspace.display().to_string(),
                &prompt,
                &mut next_memory,
                Some(bot.memory_budget - shared_usage.bytes),
                true,
            )?;
            usage.bytes += shared_usage.bytes;
            usage.titles.extend(shared_usage.titles);
            usage.budget_bytes = bot.memory_budget;
            Ok((
                format!("{}{own}", shared.strip_suffix(&prompt).unwrap_or("")),
                usage,
                mode,
            ))
        })()
    } else {
        app.state::<crate::memory::Store>().prepare(
            &workspace.display().to_string(),
            &prompt,
            &mut next_memory,
        )
    };
    let (mut prepared, memory_usage, memory_mode) = match memory_result {
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
    let action_context = if let Some(bot) = bot.as_ref().filter(|_| !check_access) {
        let identity = app.state::<crate::bots::Store>().context(bot)?;
        let (context, board) = crate::bot_actions::prepare(
            &app,
            bot,
            &workspace.display().to_string(),
            session.task_id.as_deref(),
            &turn_id,
        )?;
        prepared = format!("{identity}{board}\n{prepared}");
        Some(context)
    } else {
        None
    };
    let options = session.options.lock().unwrap().clone();
    if let Some(prefix) = prepared.strip_suffix(&prompt) {
        if !prefix.ends_with("Current request:\n") {
            prepared = format!("{prefix}Current request:\n{prompt}");
        }
    }
    let source = if managed {
        "scheduler"
    } else if remote.unwrap_or(false) {
        "phone"
    } else {
        "desktop"
    };
    prepared = format!(
        "{}{prepared}",
        crate::app_context::turn_context(
            workspace,
            provider,
            &options,
            source,
            yolo,
            Some(session.access.lock().unwrap().value(false))
        )
    );
    std::fs::write(file, provider.input(&prepared))
        .map_err(|e| format!("failed to stage prompt: {e}"))?;

    let mut cmd = providers::exec_command(
        provider,
        &cli_path,
        &session_id,
        workspace,
        file,
        yolo,
        &options,
    )?;
    let usage_session = if provider == Provider::Codex {
        session_id.clone()
    } else {
        String::new()
    };
    let usage_baseline = if usage_session.is_empty() {
        Some(crate::provider_usage::TurnUsage::zero())
    } else {
        crate::provider_usage::codex_session_file(&usage_session)
            .and_then(|path| crate::provider_usage::codex_usage(&path, i64::MIN))
            .and_then(|usage| usage.total)
    };
    let started = std::time::Instant::now();
    let started_at = chrono::Utc::now().timestamp_millis();
    let child = cmd.spawn().map_err(|e| {
        if let Some(probe) = pending.probe.as_mut() {
            session.access.lock().unwrap().agent = probe.finish();
        }
        format!("failed to launch `{}`: {e}", cli_path.display())
    })?;
    {
        let mut access = session.access.lock().unwrap();
        access.applied = Some(yolo);
        access.fresh_session_pending = false;
    }
    app.state::<crate::history::HistoryState>()
        .permission_mode(&id, yolo);

    let mut child = child;
    *session.memory.lock().unwrap() = next_memory;
    *session.shared_memory.lock().unwrap() = next_shared;
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
    if let Some(bot) = bot {
        let identity = bot.identity();
        let mut previous = session.bot_identity.lock().unwrap();
        if previous.as_ref() != Some(&identity) {
            *previous = Some(identity.clone());
            emit(&app, &id, AgentEvent::BotIdentity { bot: identity });
        }
    }
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
        TurnContext {
            probe: pending.probe.take(),
            memory_mode,
            action_context,
            started,
            started_at,
            usage_session,
            usage_baseline,
        },
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
    if let Err(error) = app
        .state::<crate::history::HistoryState>()
        .unbind(&id, &app.state::<crate::session_log::SessionLog>())
    {
        let _ = app.emit("history-status", Some(error));
    }
    app.state::<crate::session_log::SessionLog>().remove(&id);
    crate::remote::changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{home_dir, resolve_workspace, safe_fragment};
    #[test]
    fn configuration_targets_latest_tab_owner_after_reload_and_preserves_exact_ids() {
        use super::*;
        let session = |tab: &str, registration| {
            let workspace = std::path::PathBuf::from("project");
            Arc::new(AgentSession {
                registration,
                access: Mutex::new(AccessState::new(&workspace, Provider::Codex, Some(false))),
                bot_id: None,
                bot_identity: Mutex::new(None),
                task_id: None,
                shared_memory: Mutex::new(Default::default()),
                tab_id: tab.into(),
                session_id: Mutex::new(String::new()),
                provider: Provider::Codex,
                options: Mutex::new(RunOptions::default()),
                memory: Mutex::new(Default::default()),
                workspace,
                child: Mutex::new(None),
                running: Mutex::new(false),
                prompt: Mutex::new(None),
            })
        };
        let sessions = HashMap::from([
            ("old-native-z".into(), session("desktop-tab", 1)),
            ("current-native-a".into(), session("desktop-tab", 2)),
            ("unrelated-native".into(), session("another-tab", 3)),
        ]);
        assert_eq!(
            configuration_target(&sessions, "desktop-tab", true)
                .unwrap()
                .0,
            "current-native-a"
        );
        assert_eq!(
            configuration_target(&sessions, "old-native-z", false)
                .unwrap()
                .0,
            "old-native-z"
        );
        assert!(configuration_target(&sessions, "missing", true).is_none());
    }

    #[test]
    fn session_context_reports_actual_provider_and_requested_mode() {
        use super::*;
        let workspace = std::env::temp_dir();
        let mut access = AccessState::new(&workspace, Provider::Muse, None);
        access.requested = true;
        let state = AgentState::default();
        state.sessions.lock().unwrap().insert(
            "native-1".into(),
            Arc::new(AgentSession {
                registration: 0,
                access: Mutex::new(access),
                bot_id: None,
                bot_identity: Mutex::new(None),
                task_id: None,
                shared_memory: Mutex::new(Default::default()),
                tab_id: "tab".into(),
                session_id: Mutex::new(String::new()),
                provider: Provider::Muse,
                options: Mutex::new(RunOptions::default()),
                memory: Mutex::new(Default::default()),
                workspace: workspace.clone(),
                child: Mutex::new(None),
                running: Mutex::new(false),
                prompt: Mutex::new(None),
            }),
        );
        assert_eq!(
            state.session_context("native-1", &workspace),
            Some((Provider::Muse, true))
        );
        assert_eq!(state.session_context("missing", &workspace), None);
        let other = std::env::temp_dir().join(format!("velum-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&other).unwrap();
        assert_eq!(state.session_context("native-1", &other), None);
        std::fs::remove_dir(&other).unwrap();
    }

    #[test]
    fn replacement_provider_thread_invalidates_evidence_without_changing_mode() {
        let mut access = super::AccessState::new(
            std::path::Path::new("project"),
            crate::providers::Provider::Codex,
            Some(false),
        );
        access.agent.checks[0].status = crate::workspace_access::Status::Pass;
        assert!(!access.observe_session("", "first"));
        assert!(!access.observe_session("first", "first"));
        assert!(access.observe_session("first", "replacement"));
        assert_eq!(access.revision, 1);
        assert_eq!(access.applied, Some(false));
        assert!(access
            .agent
            .checks
            .iter()
            .all(|c| c.status == crate::workspace_access::Status::Untested));
        assert_eq!(access.restrictions["status"], "untested");
    }
    #[test]
    fn permission_changes_invalidate_and_require_fresh_provider_session() {
        let mut access = super::AccessState::new(
            std::path::Path::new("project"),
            crate::providers::Provider::Codex,
            Some(false),
        );
        assert!(!access.change(false, true));
        assert!(access.change(true, true));
        assert_eq!(access.revision, 1);
        assert_eq!(access.applied, None);
        assert!(
            !access.change(true, true),
            "A pending fresh Muse ID must not reset twice"
        );
        assert!(access
            .agent
            .checks
            .iter()
            .all(|c| c.status == crate::workspace_access::Status::Untested));
        access.applied = Some(true);
        assert!(!access.change(true, true));
        assert!(access.change(false, true));
        assert_eq!(access.revision, 2);
        let mut restored = super::AccessState::new(
            std::path::Path::new("project"),
            crate::providers::Provider::Codex,
            None,
        );
        assert!(
            restored.change(false, true),
            "Legacy session with unknown mode must not silently resume"
        );
    }
    #[test]
    fn new_muse_id_does_not_report_a_permission_change_before_first_turn() {
        let mut fresh = super::AccessState::new(
            std::path::Path::new("project"),
            crate::providers::Provider::Muse,
            None,
        );
        fresh.fresh_session_pending = true;
        assert!(!fresh.change(false, true));
        assert_eq!(fresh.revision, 0);
        assert!(fresh.change(true, true));
    }
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
    fn headless_denial_overrides_success_but_preserves_stop_and_partial_output() {
        use super::{headless_permission_denied, mark_permission_blocked};
        use crate::events::AgentEvent;
        assert!(headless_permission_denied("a tool required the command permission that headless mode cannot prompt for, so it was auto-denied"));
        assert!(!headless_permission_denied("Access denied (os error 5)"));
        assert!(!headless_permission_denied("Permission check passed"));
        let mut event = Some(AgentEvent::TurnEnd {
            status: "completed".into(),
            text: Some("Partial answer".into()),
            reason: None,
        });
        mark_permission_blocked(&mut event, true);
        assert!(
            matches!(&event, Some(AgentEvent::TurnEnd { status, text: Some(text), reason: Some(reason) }) if status == "blocked" && text == "Partial answer" && reason.contains("/permissions") && reason.contains("permissions.allow") && reason.contains("command(...)"))
        );
        let mut stopped = Some(AgentEvent::TurnEnd {
            status: "cancelled".into(),
            text: None,
            reason: None,
        });
        mark_permission_blocked(&mut stopped, true);
        assert!(
            matches!(stopped, Some(AgentEvent::TurnEnd { status, .. }) if status == "cancelled")
        );
    }

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
