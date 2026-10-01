//! Browser previews use an isolated Chromium profile. Native access is a
//! separate opt-in capability. Helpers accept JSON over stdin, never shell
//! interpolation or executable code from a page outside the CDP evaluator.
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
}
fn helper(command: Command, input: &Value) -> Result<Value, String> {
    helper_timeout(command, input, Duration::from_secs(25))
}
fn helper_timeout(mut command: Command, input: &Value, timeout: Duration) -> Result<Value, String> {
    hidden(&mut command);
    let mut child=command.spawn().map_err(|_|"The control helper could not start. Check Node/PowerShell installation and Windows application policy.")?;
    let bytes = serde_json::to_vec(input).unwrap();
    if child.stdin.take().unwrap().write_all(&bytes).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("The control helper input closed.".into());
    }
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = Read::by_ref(&mut stdout)
            .take(12 * 1024 * 1024)
            .read_to_end(&mut bytes);
        bytes
    });
    let err = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = Read::by_ref(&mut stderr).take(8192).read_to_end(&mut bytes);
        bytes
    });
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Err(_) => break None,
            _ => {}
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            timed_out = true;
            break None;
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let bytes = out.join().unwrap_or_default();
    let errors = err.join().unwrap_or_default();
    #[cfg(test)]
    if !status.as_ref().is_some_and(|s| s.success()) {
        eprintln!(
            "Control fixture helper: {}",
            String::from_utf8_lossy(&errors)
        );
    }
    #[cfg(not(test))]
    let _ = errors;
    if timed_out {
        return Err(format!(
            "The control operation timed out after {} seconds.",
            timeout.as_secs()
        ));
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        "Control helper failed or was blocked by Windows policy. No valid response was returned."
    })?;
    if let Some(error) = value["error"].as_str() {
        return Err(error.chars().take(400).collect());
    }
    if !status.is_some_and(|s| s.success()) {
        return Err("Control helper exited unsuccessfully.".into());
    }
    Ok(value)
}
fn chromium_candidates() -> Vec<PathBuf> {
    let roots: Vec<_> = ["PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    [
        "Microsoft/Edge/Application/msedge.exe",
        "Google/Chrome/Application/chrome.exe",
    ]
    .into_iter()
    .filter_map(|relative| {
        roots
            .iter()
            .map(|root| root.join(relative))
            .find(|p| p.is_file())
    })
    .collect()
}
fn node() -> Option<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|v| std::env::split_paths(&v).collect::<Vec<_>>())
        .map(|p| p.join(if cfg!(windows) { "node.exe" } else { "node" }))
        .find(|p| p.is_file())
}
pub fn browser_available() -> bool {
    cfg!(windows) && !chromium_candidates().is_empty() && node().is_some()
}

fn clean_profile(profile: &std::path::Path) {
    let Ok(base) = std::fs::canonicalize(std::env::temp_dir()) else {
        return;
    };
    let Ok(target) = std::fs::canonicalize(profile) else {
        return;
    };
    if target.parent() == Some(base.as_path())
        && target
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("velum-browser-"))
        && std::fs::symlink_metadata(profile).is_ok_and(|m| !crate::workspace_tools::linked(&m))
    {
        let _ = std::fs::remove_dir_all(target);
    }
}

pub struct Browser {
    child: Child,
    profile: PathBuf,
    endpoint: String,
    node: PathBuf,
}
impl Browser {
    pub fn start() -> Result<Self, String> {
        let candidates = chromium_candidates();
        if candidates.is_empty() {
            return Err("Install Microsoft Edge or Google Chrome for browser previews.".into());
        }
        let node =
            node().ok_or("Node.js 22 or newer is required for isolated browser previews.")?;
        let mut version = Command::new(&node);
        version.arg("--version");
        hidden(&mut version);
        let output = version
            .output()
            .map_err(|_| "Cannot read Node.js version.")?;
        let major = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_start_matches('v')
            .split('.')
            .next()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        if major < 22 {
            return Err(
                "Browser previews require Node.js 22 or newer (built-in WebSocket).".into(),
            );
        }
        Self::start_candidates(&candidates, node)
    }
    fn start_candidates(candidates: &[PathBuf], node: PathBuf) -> Result<Self, String> {
        // Two fresh-profile attempts plus a bounded browser operation fit
        // within the existing 40-second MCP transport timeout.
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(350))
            .build()
            .map_err(|_| "Cannot check preview browser readiness.")?;
        let mut failures = vec![];
        for executable in candidates.iter().take(2) {
            match Self::start_one(executable, &node, &client) {
                Ok(browser) => return Ok(browser),
                Err(reason) => {
                    let name = executable.file_name().unwrap_or_default().to_string_lossy();
                    failures.push(format!("{name}: {reason}"));
                }
            }
        }
        Err(format!("Isolated browser startup failed ({}). Check browser updates and Windows application policy.", failures.join("; ")))
    }
    fn start_one(
        executable: &std::path::Path,
        node: &std::path::Path,
        client: &reqwest::blocking::Client,
    ) -> Result<Self, String> {
        let profile = std::env::temp_dir().join(format!("velum-browser-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&profile).map_err(|_| "Cannot create the isolated browser profile.")?;
        let mut command = Command::new(executable);
        command
            .args([
                "--headless=new",
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--no-first-run",
                "--no-default-browser-check",
                "--window-size=1280,900",
            ])
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("about:blank");
        hidden(&mut command);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                let _ = std::fs::remove_dir(&profile);
                return Err("process could not be launched".into());
            }
        };
        let started = Instant::now();
        let readiness = loop {
            if let Ok(data) = std::fs::read_to_string(profile.join("DevToolsActivePort")) {
                if let Some(endpoint) = ready_endpoint(client, &data) {
                    break Ok(endpoint);
                }
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    break Err(format!(
                        "process exited before its debug endpoint was ready (code {})",
                        status
                            .code()
                            .map(|c| c.to_string())
                            .unwrap_or_else(|| "unavailable".into())
                    ))
                }
                Err(_) => break Err("process status could not be checked".to_string()),
                _ => {}
            }
            if started.elapsed() > Duration::from_secs(9) {
                break Err("debug endpoint was not ready within 9 seconds".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let endpoint = match readiness {
            Ok(endpoint) => endpoint,
            Err(reason) => {
                let _ = child.kill();
                let _ = child.wait();
                clean_profile(&profile);
                return Err(reason);
            }
        };
        Ok(Self {
            child,
            profile,
            endpoint,
            node: node.to_path_buf(),
        })
    }
    pub fn call(&mut self, name: &str, args: &Value) -> Result<Value, String> {
        let mut command = Command::new(&self.node);
        command.arg("-e").arg(include_str!("tool-browser.cjs"));
        helper_timeout(
            command,
            &json!({"endpoint":self.endpoint,"tool":name,"args":args}),
            Duration::from_secs(20),
        )
    }
}
fn ready_endpoint(client: &reqwest::blocking::Client, data: &str) -> Option<String> {
    let mut lines = data.lines();
    let port = lines.next()?.parse::<u16>().ok().filter(|p| *p > 0)?;
    let path = lines.next()?.trim();
    if !path.starts_with("/devtools/browser/") {
        return None;
    }
    let endpoint = format!("http://127.0.0.1:{port}");
    let body = client
        .get(format!("{endpoint}/json/version"))
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .ok()?;
    let value: Value = serde_json::from_str(&body).ok()?;
    let socket = reqwest::Url::parse(value["webSocketDebuggerUrl"].as_str()?).ok()?;
    (socket.scheme() == "ws"
        && socket.host_str() == Some("127.0.0.1")
        && socket.port() == Some(port)
        && socket.path() == path
        && socket.username().is_empty()
        && socket.password().is_none())
    .then_some(endpoint)
}
impl Drop for Browser {
    fn drop(&mut self) {
        let _ = self.call("browser_close", &json!({}));
        let _ = self.child.kill();
        let _ = self.child.wait();
        // This path was created here from a fixed prefix + UUID. Never remove
        // the user's browser profile or a tool-supplied path.
        clean_profile(&self.profile);
    }
}

pub fn native(name: &str, args: &Value) -> Result<Value, String> {
    if !cfg!(windows) {
        return Err("Native window controls are available on Windows only.".into());
    }
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
        .arg(include_str!("tool-native.ps1"));
    helper(command, &json!({"tool":name,"args":args}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_helper_checks_window_ids_before_input() {
        if !cfg!(windows) {
            return;
        }
        assert!(native(
            "native_input",
            &json!({"window_id":"-1","action":"type","text":"never typed"})
        )
        .is_err());
        let windows = native("native_windows", &json!({})).unwrap();
        assert!(windows["windows"].is_array());
    }
    #[test]
    fn browser_falls_back_after_a_missing_or_exited_first_process() {
        if !browser_available() {
            return;
        }
        let valid = chromium_candidates()[0].clone();
        let missing = std::env::temp_dir().join(format!(
            "velum-missing-browser-{}.exe",
            uuid::Uuid::new_v4()
        ));
        // where.exe rejects Chromium arguments and exits without opening a
        // browser. This exercises startup failure without changing OS policy.
        let exited =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/where.exe");
        for first in [missing.clone(), exited.clone()] {
            let browser =
                Browser::start_candidates(&[first, valid.clone()], node().unwrap()).unwrap();
            let profile = browser.profile.clone();
            assert!(browser.endpoint.starts_with("http://127.0.0.1:"));
            drop(browser);
            assert!(!profile.exists());
        }
        let error = Browser::start_candidates(&[exited, missing], node().unwrap())
            .err()
            .unwrap();
        assert!(error.contains("process exited"));
        assert!(error.contains("process could not be launched"));
        assert!(!error.contains(&std::env::temp_dir().to_string_lossy().to_string()));
    }
    #[test]
    fn browser_readiness_requires_a_matching_live_debug_endpoint() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            for socket in [
                format!("ws://example.invalid:{port}/devtools/browser/test"),
                format!("ws://127.0.0.1:{port}/devtools/browser/other"),
                format!("ws://127.0.0.1:{port}/devtools/browser/test"),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let _ = stream.read(&mut [0; 2048]);
                let content = json!({"webSocketDebuggerUrl":socket}).to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{content}",content.len()).unwrap();
            }
        });
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(1))
            .build()
            .unwrap();
        for data in [
            "",
            "0\n/devtools/browser/test",
            "invalid\n/devtools/browser/test",
            "65536\n/devtools/browser/test",
            "9\nwrong-path",
        ] {
            assert!(ready_endpoint(&client, data).is_none());
        }
        let data = format!("{port}\n/devtools/browser/test\n");
        assert!(ready_endpoint(&client, &data).is_none());
        assert!(ready_endpoint(&client, &data).is_none());
        assert_eq!(
            ready_endpoint(&client, &data),
            Some(format!("http://127.0.0.1:{port}"))
        );
        server.join().unwrap();
    }
    #[test]
    fn isolated_browser_controls_and_screenshots_are_real() {
        if !browser_available() {
            return;
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(20) {
                if let Ok((mut stream, _)) = listener.accept() {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                    let mut request = [0; 8192];
                    let _ = stream.read(&mut request);
                    let content="<!doctype html><title>Velum isolated test</title><h1>Preview test</h1><input id='text'><button id='apply' onclick=\"document.querySelector('#out').textContent=document.querySelector('#text').value\">Apply</button><p id='out'></p>";
                    let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",content.len(),content);
                } else {
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        });
        let mut browser = Browser::start().unwrap();
        let profile = browser.profile.clone();
        let tab = browser
            .call("browser_open", &json!({"url":format!("http://{address}")}))
            .unwrap();
        let id = tab["tab_id"].clone();
        for _ in 0..20 {
            if browser
                .call("browser_snapshot", &json!({"tab_id":id}))
                .unwrap()
                .to_string()
                .contains("Velum isolated test")
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        browser
            .call(
                "browser_action",
                &json!({"tab_id":id,"action":"fill","selector":"#text","text":"typed fixture"}),
            )
            .unwrap();
        browser
            .call(
                "browser_action",
                &json!({"tab_id":id,"action":"click","selector":"#apply"}),
            )
            .unwrap();
        assert!(browser.call("browser_action",&json!({"tab_id":id,"action":"evaluate","expression":"document.querySelector('#out').textContent"})).unwrap()["result"].as_str().unwrap().contains("typed fixture"));
        assert!(browser
            .call("browser_screenshot", &json!({"tab_id":id}))
            .unwrap()["image_base64"]
            .as_str()
            .unwrap()
            .starts_with("iVBOR"));
        drop(browser);
        assert!(!profile.exists());
        server.join().unwrap();
    }
}
