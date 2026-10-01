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
fn helper(mut command: Command, input: &Value) -> Result<Value, String> {
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
        if started.elapsed() > Duration::from_secs(25) {
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
        return Err("The control operation timed out after 25 seconds.".into());
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
fn chromium() -> Option<PathBuf> {
    let mut paths = vec![];
    for env in ["PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"] {
        if let Some(dir) = std::env::var_os(env) {
            let dir = PathBuf::from(dir);
            paths.push(dir.join("Microsoft/Edge/Application/msedge.exe"));
            paths.push(dir.join("Google/Chrome/Application/chrome.exe"));
        }
    }
    paths.into_iter().find(|p| p.is_file())
}
fn node() -> Option<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|v| std::env::split_paths(&v).collect::<Vec<_>>())
        .map(|p| p.join(if cfg!(windows) { "node.exe" } else { "node" }))
        .find(|p| p.is_file())
}
pub fn browser_available() -> bool {
    cfg!(windows) && chromium().is_some() && node().is_some()
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
        let executable =
            chromium().ok_or("Install Microsoft Edge or Google Chrome for browser previews.")?;
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
                return Err("The isolated preview browser could not start.")?;
            }
        };
        let started = Instant::now();
        let endpoint = loop {
            if let Ok(data) = std::fs::read_to_string(profile.join("DevToolsActivePort")) {
                if let Some(port) = data.lines().next().and_then(|p| p.parse::<u16>().ok()) {
                    break format!("http://127.0.0.1:{port}");
                }
            }
            if started.elapsed() > Duration::from_secs(12)
                || child.try_wait().ok().flatten().is_some()
            {
                let _ = child.kill();
                let _ = child.wait();
                clean_profile(&profile);
                return Err("Browser debug endpoint did not start. Check browser installation and Windows application policy.".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        Ok(Self {
            child,
            profile,
            endpoint,
            node,
        })
    }
    pub fn call(&mut self, name: &str, args: &Value) -> Result<Value, String> {
        let mut command = Command::new(&self.node);
        command.arg("-e").arg(include_str!("tool-browser.cjs"));
        helper(
            command,
            &json!({"endpoint":self.endpoint,"tool":name,"args":args}),
        )
    }
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
