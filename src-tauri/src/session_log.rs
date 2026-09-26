//! Backend-owned replay buffers let phones reconnect without depending on WebView timers.
use crate::events::AgentEvent;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 8_000;

#[derive(Clone, Serialize)]
pub struct Entry {
    pub seq: u64,
    pub event: AgentEvent,
}

#[derive(Clone, Serialize)]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub workspace: String,
    pub running: bool,
    pub status: String,
    pub revision: u64,
}

struct Log {
    summary: Summary,
    events: VecDeque<(Entry, usize)>,
    bytes: usize,
}

#[derive(Serialize)]
pub struct Replay {
    pub session: Summary,
    pub events: Vec<Entry>,
    pub truncated: bool,
}

#[derive(Default)]
pub struct SessionLog(Mutex<HashMap<String, Log>>);

impl SessionLog {
    pub fn register(&self, id: &str, workspace: String) {
        self.0.lock().unwrap().insert(
            id.into(),
            Log {
                summary: Summary {
                    id: id.into(),
                    title: "New conversation".into(),
                    workspace,
                    running: false,
                    status: "idle".into(),
                    revision: 0,
                },
                events: VecDeque::new(),
                bytes: 0,
            },
        );
    }

    pub fn remove(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }

    pub fn record(&self, id: &str, event: &AgentEvent) {
        // The runner emits an authoritative turn_start before reading CLI output.
        if matches!(event, AgentEvent::UserMessage { .. }) {
            return;
        }
        let mut logs = self.0.lock().unwrap();
        let Some(log) = logs.get_mut(id) else {
            return;
        };
        match event {
            AgentEvent::TurnStart { prompt, .. } => {
                if log.summary.revision == 0 {
                    log.summary.title = prompt
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .chars()
                        .take(64)
                        .collect();
                }
                log.summary.running = true;
                log.summary.status = "running".into();
            }
            AgentEvent::TurnEnd { status, .. } => {
                log.summary.running = false;
                log.summary.status.clone_from(status);
            }
            _ => {}
        }
        log.summary.revision += 1;
        let size = serde_json::to_vec(event).map(|v| v.len()).unwrap_or(0);
        log.events.push_back((
            Entry {
                seq: log.summary.revision,
                event: event.clone(),
            },
            size,
        ));
        log.bytes += size;
        while log.events.len() > MAX_EVENTS || log.bytes > MAX_BYTES {
            if let Some((_, bytes)) = log.events.pop_front() {
                log.bytes -= bytes;
            } else {
                break;
            }
        }
    }

    pub fn summaries(&self) -> Vec<Summary> {
        let mut items: Vec<_> = self
            .0
            .lock()
            .unwrap()
            .values()
            .map(|log| log.summary.clone())
            .collect();
        items.sort_by(|a, b| b.running.cmp(&a.running).then(a.id.cmp(&b.id)));
        items
    }

    pub fn replay(&self, id: &str, after: u64) -> Option<Replay> {
        self.0.lock().unwrap().get(id).map(|log| Replay {
            session: log.summary.clone(),
            events: log
                .events
                .iter()
                .filter(|(e, _)| e.seq > after)
                .map(|(e, _)| e.clone())
                .collect(),
            truncated: log
                .events
                .front()
                .is_some_and(|(e, _)| e.seq > after.saturating_add(1)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replay_is_ordered_and_tracks_remote_turns_without_cli_echoes() {
        let log = SessionLog::default();
        log.register("one", "C:\\project".into());
        log.record(
            "one",
            &AgentEvent::TurnStart {
                prompt: "Review code".into(),
                remote: true,
            },
        );
        log.record(
            "one",
            &AgentEvent::UserMessage {
                text: "Review code".into(),
            },
        );
        log.record(
            "one",
            &AgentEvent::AssistantDelta {
                text: "Hello".into(),
            },
        );
        let replay = log.replay("one", 1).unwrap();
        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].seq, 2);
        assert!(replay.session.running);
        log.record(
            "one",
            &AgentEvent::TurnEnd {
                status: "completed".into(),
                text: None,
                reason: None,
            },
        );
        assert!(!log.replay("one", 2).unwrap().session.running);
        log.remove("one");
        assert!(log.replay("one", 0).is_none());
    }
    #[test]
    fn buffers_are_bounded_and_disclose_missing_history() {
        let log = SessionLog::default();
        log.register("one", "workspace".into());
        for _ in 0..300 {
            log.record(
                "one",
                &AgentEvent::AssistantDelta {
                    text: "x".repeat(12_000),
                },
            );
        }
        let replay = log.replay("one", 0).unwrap();
        assert!(replay.truncated);
        assert!(replay.events.len() < 200);
        assert_eq!(replay.session.revision, 300);
    }
}
