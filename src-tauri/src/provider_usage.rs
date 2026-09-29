//! Provider counters are separate from Velum's approximate memory-token count.
//! Never use cumulative billable tokens as the current context occupancy.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

const MAX_COUNTER: u64 = 9_007_199_254_740_991;
const TAIL_BYTES: u64 = 512 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TurnUsage {
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_output_tokens: Option<u64>,
    pub elapsed_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContextUsage {
    pub used_tokens: u64,
    pub window_tokens: Option<u64>,
    pub measured_at: i64,
}

pub struct CodexUsage {
    pub context: ContextUsage,
    pub total: Option<TurnUsage>,
}

impl TurnUsage {
    pub fn zero() -> Self {
        Self {
            input_tokens: Some(0),
            cached_input_tokens: Some(0),
            output_tokens: Some(0),
            reasoning_output_tokens: Some(0),
            elapsed_ms: None,
        }
    }

    /// Session totals are monotonic. A reset or missing baseline makes the
    /// rate unavailable rather than counting earlier turns again.
    pub fn since(&self, baseline: &Self, elapsed_ms: u64) -> Self {
        fn delta(current: Option<u64>, previous: Option<u64>) -> Option<u64> {
            current?.checked_sub(previous?)
        }
        Self {
            input_tokens: delta(self.input_tokens, baseline.input_tokens),
            cached_input_tokens: delta(self.cached_input_tokens, baseline.cached_input_tokens),
            output_tokens: delta(self.output_tokens, baseline.output_tokens),
            reasoning_output_tokens: delta(
                self.reasoning_output_tokens,
                baseline.reasoning_output_tokens,
            ),
            elapsed_ms: Some(elapsed_ms),
        }
    }
}

fn counter(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= MAX_COUNTER)
}

/// Normalize provider counters. Their scope comes from the containing event;
/// cumulative totals need a baseline before they can describe a single turn.
pub fn codex_turn(value: &Value) -> Option<TurnUsage> {
    let usage = TurnUsage {
        input_tokens: counter(&value["input_tokens"]),
        cached_input_tokens: counter(&value["cached_input_tokens"]),
        output_tokens: counter(&value["output_tokens"]),
        reasoning_output_tokens: counter(&value["reasoning_output_tokens"]),
        elapsed_ms: None,
    };
    (usage.input_tokens.is_some() || usage.output_tokens.is_some()).then_some(usage)
}

/// Locate only the UUID returned by the active provider. Bound the search,
/// do not traverse symlinks, and never select a different recent thread.
pub fn codex_session_file(session: &str) -> Option<PathBuf> {
    uuid::Uuid::parse_str(session).ok()?;
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::pty::home_dir().join(".codex"));
    let suffix = format!("-{session}.jsonl");
    fn find(root: &Path, suffix: &str, depth: usize, budget: &mut usize) -> Option<PathBuf> {
        for entry in fs::read_dir(root).ok()?.flatten() {
            if *budget == 0 {
                return None;
            }
            *budget -= 1;
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_file() && entry.file_name().to_string_lossy().ends_with(suffix) {
                return Some(entry.path());
            }
            if kind.is_dir() && depth > 0 {
                if let Some(path) = find(&entry.path(), suffix, depth - 1, budget) {
                    return Some(path);
                }
            }
        }
        None
    }
    find(&home.join("sessions"), &suffix, 3, &mut 30_000)
}

/// Read a bounded tail, retaining only numeric token metadata. The snapshot
/// must belong to this turn; old model/window values cannot revive a reset.
pub fn codex_usage(path: &Path, since_ms: i64) -> Option<CodexUsage> {
    let mut file = fs::File::open(path).ok()?;
    let start = file.metadata().ok()?.len().saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    let mut latest = None;
    for (index, line) in bytes.split(|b| *b == b'\n').enumerate() {
        if index == 0 && start > 0 {
            continue; // The first record may begin outside the bounded tail.
        }
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if value["type"] != "event_msg" || value["payload"]["type"] != "token_count" {
            continue;
        }
        let Some(stamp) = value["timestamp"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        else {
            continue;
        };
        let measured_at = stamp.timestamp_millis();
        if measured_at < since_ms {
            continue;
        }
        let info = &value["payload"]["info"];
        let last = &info["last_token_usage"];
        // The provider includes reasoning within output/total; never add it twice.
        let used = counter(&last["total_tokens"]).or_else(|| {
            counter(&last["input_tokens"])?
                .checked_add(counter(&last["output_tokens"])?)
                .filter(|n| *n <= MAX_COUNTER)
        });
        if let Some(used_tokens) = used {
            latest = Some(CodexUsage {
                context: ContextUsage {
                    used_tokens,
                    window_tokens: counter(&info["model_context_window"]).filter(|n| *n > 0),
                    measured_at,
                },
                total: codex_turn(&info["total_token_usage"]),
            });
        }
    }
    latest
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Log(PathBuf);
    impl Log {
        fn new(text: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("velum-usage-{}.jsonl", uuid::Uuid::new_v4()));
            fs::write(&path, text).unwrap();
            Self(path)
        }
    }
    impl Drop for Log {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    fn record() -> Value {
        json!({"timestamp":"2026-09-29T18:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{
            "model_context_window":258400,
            "last_token_usage":{"input_tokens":18000,"output_tokens":300,"reasoning_output_tokens":100,"total_tokens":18300},
            "total_token_usage":{"input_tokens":146448,"cached_input_tokens":100000,"output_tokens":899,"reasoning_output_tokens":400}
        }}})
    }
    #[test]
    fn context_uses_latest_request_not_cumulative_billing_or_double_reasoning() {
        let log = Log::new(&record().to_string());
        let result = codex_usage(&log.0, i64::MIN).unwrap();
        assert_eq!(result.context.used_tokens, 18300);
        assert_eq!(result.context.window_tokens, Some(258400));
        assert_eq!(result.total.unwrap().input_tokens, Some(146448));
    }
    #[test]
    fn resumed_turn_subtracts_baseline_and_missing_or_reset_counts_stay_unknown() {
        let baseline =
            codex_turn(&json!({"input_tokens":100,"cached_input_tokens":70,"output_tokens":20}))
                .unwrap();
        let current = codex_turn(&json!({"input_tokens":150,"cached_input_tokens":100,"output_tokens":30,"reasoning_output_tokens":4})).unwrap();
        let turn = current.since(&baseline, 2000);
        assert_eq!(turn.input_tokens, Some(50));
        assert_eq!(turn.cached_input_tokens, Some(30));
        assert_eq!(turn.output_tokens, Some(10));
        assert_eq!(turn.reasoning_output_tokens, None);
        assert_eq!(turn.elapsed_ms, Some(2000));
        assert_eq!(baseline.since(&current, 2000).output_tokens, None);
        assert_eq!(
            current.since(&TurnUsage::default(), 2000).output_tokens,
            None
        );
    }
    #[test]
    fn counters_reject_negative_fractional_and_unsafe_integers() {
        assert!(codex_turn(&json!({"input_tokens":-1,"output_tokens":1.2})).is_none());
        assert!(codex_turn(&json!({"output_tokens":MAX_COUNTER+1})).is_none());
        assert_eq!(
            codex_turn(&json!({"output_tokens":0}))
                .unwrap()
                .output_tokens,
            Some(0)
        );
    }
    #[test]
    fn stale_snapshots_cannot_revive_reset_or_changed_model_context() {
        let log = Log::new(&record().to_string());
        let stamp = codex_usage(&log.0, i64::MIN).unwrap().context.measured_at;
        assert!(codex_usage(&log.0, stamp + 1).is_none());
        assert!(codex_usage(&log.0, stamp).is_some());
    }
    #[test]
    fn fallback_excludes_reasoning_and_unknown_capacity_remains_unknown() {
        let mut value = record();
        value["payload"]["info"]["last_token_usage"]["total_tokens"] = Value::Null;
        value["payload"]["info"]["model_context_window"] = json!(0);
        let log = Log::new(&value.to_string());
        let result = codex_usage(&log.0, i64::MIN).unwrap();
        assert_eq!(result.context.used_tokens, 18300);
        assert_eq!(result.context.window_tokens, None);
    }
    #[test]
    fn bounded_tail_ignores_messages_partial_records_and_invalid_json() {
        let log = Log::new(&format!(
            "{}\n{{invalid\n{}\n{}\n{{unfinished",
            "x".repeat(TAIL_BYTES as usize + 20),
            json!({"type":"response_item","payload":{"content":"private content"}}),
            record()
        ));
        assert_eq!(
            codex_usage(&log.0, i64::MIN).unwrap().context.used_tokens,
            18300
        );
        assert!(codex_session_file("../../different-thread").is_none());
    }
}
