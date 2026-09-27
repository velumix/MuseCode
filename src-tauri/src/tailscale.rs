//! Use the installed client and an app-owned foreground Serve configuration.
//! Closing the window keeps it alive; Quit drops only VelumCode's listener.
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub const HTTPS_PORT: u16 = 8443;

#[derive(Clone, Default, Serialize)]
pub struct Status {
    pub installed: bool,
    pub connected: bool,
    pub hostname: Option<String>,
    pub message: String,
}

pub fn executable() -> Option<PathBuf> {
    let standard = PathBuf::from(
        std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()),
    )
    .join("Tailscale/tailscale.exe");
    if standard.is_file() {
        return Some(standard);
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| {
                dir.join(if cfg!(windows) {
                    "tailscale.exe"
                } else {
                    "tailscale"
                })
            })
            .find(|path| path.is_file())
    })
}

fn command() -> Result<Command, String> {
    let mut command =
        Command::new(executable().ok_or("Install Tailscale on this computer, then sign in.")?);
    command.kill_on_drop(true).stdin(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    Ok(command)
}

async fn json(args: &[&str]) -> Result<Value, String> {
    let output = tokio::time::timeout(Duration::from_secs(10), command()?.args(args).output())
        .await
        .map_err(|_| "Tailscale took too long to respond. Check that it is running.")?
        .map_err(|e| format!("Could not run Tailscale: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(1600)
            .collect());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Tailscale returned an unreadable status.".into())
}

pub async fn status() -> Status {
    if executable().is_none() {
        return Status {
            message: "Install Tailscale on your desktop and phone to get started.".into(),
            ..Status::default()
        };
    }
    match json(&["status", "--json", "--peers=false"]).await {
        Ok(value) => {
            let connected = value["BackendState"] == "Running";
            let hostname = value["Self"]["DNSName"]
                .as_str()
                .map(|s| s.trim_end_matches('.').to_owned())
                .filter(|s| !s.is_empty());
            Status {
                installed: true,
                connected,
                hostname,
                message: if connected {
                    "Connected to your private network."
                } else {
                    "Open Tailscale and sign in, then refresh."
                }
                .into(),
            }
        }
        Err(message) => Status {
            installed: true,
            message,
            ..Status::default()
        },
    }
}

fn port_in_use(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            key == &HTTPS_PORT.to_string()
                || key.ends_with(&format!(":{HTTPS_PORT}"))
                || port_in_use(value)
        }),
        Value::Array(items) => items.iter().any(port_in_use),
        _ => false,
    }
}

fn contains_proxy(value: &Value, target: &str) -> bool {
    match value {
        Value::Object(map) => {
            map.get("Proxy").and_then(Value::as_str) == Some(target)
                || map.values().any(|v| contains_proxy(v, target))
        }
        Value::Array(items) => items.iter().any(|v| contains_proxy(v, target)),
        _ => false,
    }
}

pub async fn start(port: u16) -> Result<Child, String> {
    let config = json(&["serve", "status", "--json"]).await?;
    if port_in_use(&config) {
        return Err("Tailscale port 8443 is already serving another app. Free that port before enabling VelumCode remote access; your existing routes were left untouched.".into());
    }
    let target = format!("http://127.0.0.1:{port}");
    let mut child = command()?
        .args(["serve", "--yes", "--https=8443", &target])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let output = Arc::new(Mutex::new(String::new()));
    if let Some(stdout) = child.stdout.take() {
        collect(stdout, output.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        collect(stderr, output.clone());
    }
    for _ in 0..12 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err(format!(
                "Tailscale Serve could not start. {}",
                output.lock().unwrap()
            ));
        }
        if json(&["serve", "status", "--json"])
            .await
            .is_ok_and(|v| contains_proxy(&v, &target))
        {
            return Ok(child);
        }
    }
    let _ = child.kill().await;
    Err(format!(
        "Finish enabling HTTPS in Tailscale, then try again. {}",
        output.lock().unwrap()
    ))
}

fn collect<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    reader: R,
    output: Arc<Mutex<String>>,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut text = output.lock().unwrap();
            if text.len() < 4096 {
                text.push_str(&line);
                text.push('\n');
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_existing_routes_including_foreground_and_funnel() {
        assert!(port_in_use(
            &serde_json::json!({"TCP":{"8443":{"HTTPS":true}}})
        ));
        assert!(port_in_use(
            &serde_json::json!({"Foreground":{"x":{"Web":{"pc.tail.ts.net:8443":{}}}}})
        ));
        assert!(port_in_use(
            &serde_json::json!({"AllowFunnel":{"pc.tail.ts.net:8443":true}})
        ));
        assert!(!port_in_use(
            &serde_json::json!({"TCP":{"443":{"HTTPS":true}}})
        ));
    }
}
