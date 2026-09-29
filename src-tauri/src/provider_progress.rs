//! A small allowlist of provider connection facts, never raw request metadata.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Connecting,
    Retrying,
    Connected,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Progress {
    pub phase: Phase,
    pub checked_at_ms: u64,
    pub attempt: Option<u64>,
    pub max_attempts: Option<u64>,
    pub http_status: Option<u64>,
    pub retry_at_ms: Option<u64>,
}

impl Progress {
    pub fn message(&self) -> String {
        match self.phase {
            Phase::Connecting => "Connecting to Muse…".into(),
            Phase::Connected => "Muse response received".into(),
            Phase::Retrying => match self.http_status {
                Some(401) => "Muse sign-in was rejected (HTTP 401)".into(),
                Some(403) => "Muse service denied the request (HTTP 403)".into(),
                Some(429) => "Muse service is rate limited (HTTP 429)".into(),
                Some(code @ 500..=599) => {
                    format!("Muse service is temporarily unavailable (HTTP {code})")
                }
                Some(code) => format!("Muse request failed (HTTP {code})"),
                None => "Muse connection was interrupted".into(),
            },
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

pub fn muse(details: &Value, now: u64) -> Option<Progress> {
    let phase = match details["phase"].as_str()? {
        "opening_stream" => Phase::Connecting,
        "retry_scheduled" => Phase::Retrying,
        "stream_succeeded" => Phase::Connected,
        _ => return None,
    };
    let attempt = details["facets"].as_array()?.iter().find(|f| {
        f["kind"] == "external_attempt"
            && f["system"] == "meta"
            && f["operation"] == "model.response"
    })?;
    let count = |key: &str| attempt[key].as_u64().filter(|n| (1..=1000).contains(n));
    let retrying = phase == Phase::Retrying;
    Some(Progress {
        phase,
        checked_at_ms: now,
        attempt: if retrying {
            count("next_attempt")
        } else {
            count("attempt")
        },
        max_attempts: count("max_attempts"),
        http_status: retrying
            .then(|| {
                attempt["http_status"]
                    .as_u64()
                    .filter(|s| (100..=599).contains(s))
            })
            .flatten(),
        retry_at_ms: retrying
            .then(|| {
                attempt["retry_delay_ms"]
                    .as_u64()
                    .filter(|delay| *delay <= 86_400_000)
                    .and_then(|delay| now.checked_add(delay))
            })
            .flatten(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn real_muse_retry_shape_preserves_only_safe_facts() {
        let status = muse(&json!({"phase":"retry_scheduled","facets":[
            {"kind":"external_attempt","system":"meta","operation":"model.response","attempt":1,"next_attempt":2,"max_attempts":10,"retry_delay_ms":60000,"http_status":503,"error_kind":"server","token":"PRIVATE"},
            {"kind":"producer","detail":{"request_id":"PRIVATE","url":"https://private.example/"}}
        ]}), 1000).unwrap();
        assert_eq!(status.phase, Phase::Retrying);
        assert_eq!(status.retry_at_ms, Some(61_000));
        assert_eq!(status.attempt, Some(2));
        assert_eq!(status.max_attempts, Some(10));
        assert_eq!(
            status.message(),
            "Muse service is temporarily unavailable (HTTP 503)"
        );
        assert!(!serde_json::to_string(&status).unwrap().contains("PRIVATE"));
    }

    #[test]
    fn success_clears_errors_and_malformed_metadata_is_not_trusted() {
        let mut details = json!({"phase":"stream_succeeded","facets":[{"kind":"external_attempt","system":"meta","operation":"model.response","attempt":2,"max_attempts":10,"http_status":503,"retry_delay_ms":60000}]});
        let status = muse(&details, 3000).unwrap();
        assert_eq!(status.phase, Phase::Connected);
        assert_eq!(status.http_status, None);
        assert_eq!(status.retry_at_ms, None);
        details["phase"] = json!("retry_scheduled");
        details["facets"][0]["retry_delay_ms"] = json!(-1);
        details["facets"][0]["next_attempt"] = json!("PRIVATE");
        details["facets"][0]["http_status"] = json!(9999);
        let status = muse(&details, 0).unwrap();
        assert_eq!(status.attempt, None);
        assert_eq!(status.http_status, None);
        assert_eq!(status.retry_at_ms, None);
        details["facets"][0]["operation"] = json!("tool.response");
        assert!(muse(&details, 0).is_none());
    }
}
