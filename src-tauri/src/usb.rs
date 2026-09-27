//! ADB carries a loopback-only connection over an authorized USB cable.
use serde::Serialize;
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::process::Command;

pub const PORT: u16 = 43827;
pub const ORIGIN: &str = "http://127.0.0.1:43827";
const SOCKET: &str = "tcp:43827";
const PACKAGES: [&str; 2] = [
    "com.velumix.musecode.phone",
    "com.velumix.musecode.phone.debug",
];

#[derive(Clone, Serialize)]
pub struct Device {
    pub serial: String,
    pub name: String,
    pub authorized: bool,
}

pub fn executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(root) = std::env::var_os(key) {
            candidates.push(PathBuf::from(root).join("platform-tools/adb.exe"));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Android/Sdk/platform-tools/adb.exe"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .map(|dir| dir.join(if cfg!(windows) { "adb.exe" } else { "adb" })),
        );
    }
    candidates.into_iter().find(|path| path.is_file())
}

async fn run(args: &[&str]) -> Result<String, String> {
    let mut command =
        Command::new(executable().ok_or(
            "Install Android SDK Platform-Tools, then put adb on PATH or set ANDROID_HOME.",
        )?);
    command.args(args).stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .map_err(|_| "The phone did not respond. Unlock it and check its USB debugging prompt.")?
        .map_err(|e| format!("Could not run ADB: {e}"))?;
    if !output.status.success() {
        // Do not echo command arguments: opening the app includes a one-use invitation.
        return Err(
            "USB command failed. Check the cable and allow USB debugging on the phone.".into(),
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn valid_serial(serial: &str) -> bool {
    !serial.is_empty()
        && serial.len() <= 128
        && !serial.starts_with("emulator-")
        && serial
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && serial.as_bytes()[0].is_ascii_alphanumeric()
}

fn parse_devices(output: &str) -> Vec<Device> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            if !valid_serial(serial) || !matches!(state, "device" | "unauthorized" | "offline") {
                return None;
            }
            let model = parts.find_map(|part| part.strip_prefix("model:"));
            Some(Device {
                serial: serial.into(),
                name: model.unwrap_or("Android phone").replace('_', " "),
                authorized: state == "device",
            })
        })
        .collect()
}

pub async fn devices() -> Result<Vec<Device>, String> {
    Ok(parse_devices(&run(&["devices", "-l"]).await?))
}

pub async fn require_phone(serial: &str) -> Result<(Device, &'static str), String> {
    let device = devices()
        .await?
        .into_iter()
        .find(|d| d.serial == serial && d.authorized)
        .ok_or(
            "Connect the phone with a data cable, enable USB debugging, and allow this computer.",
        )?;
    for package in PACKAGES {
        let installed = run(&["-s", serial, "shell", "pm", "list", "packages", package]).await?;
        if installed
            .lines()
            .any(|s| s.trim() == format!("package:{package}"))
        {
            return Ok((device, package));
        }
    }
    Err("Install the VelumCode APK on this phone first.".into())
}

fn mapping(output: &str) -> Option<&str> {
    output.lines().find_map(|line| {
        let parts: Vec<_> = line.split_whitespace().collect();
        (parts.len() == 3 && parts[1] == SOCKET).then(|| parts[2])
    })
}

pub async fn connect(serial: &str) -> Result<(), String> {
    let routes = run(&["-s", serial, "reverse", "--list"]).await?;
    match mapping(&routes) {
        Some(SOCKET) => Ok(()), // Reuse VelumCode's route after unplugging or restarting.
        Some(_) => Err("USB port 43827 is already forwarded to another app. Remove that forwarding before connecting VelumCode.".into()),
        None => run(&["-s", serial, "reverse", "--no-rebind", SOCKET, SOCKET]).await.map(|_| ()),
    }
}

pub async fn open(serial: &str, package: &str, url: &str) -> Result<(), String> {
    let component = format!("{package}/com.velumix.musecode.phone.MainActivity");
    let output = run(&[
        "-s",
        serial,
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        &component,
        "--es",
        "muse_usb_url",
        url,
    ])
    .await?;
    if output.contains("Error:") {
        return Err("Could not open VelumCode. Install the latest APK on this phone.".into());
    }
    Ok(())
}

pub async fn disconnect(serial: &str) {
    if let Ok(routes) = run(&["-s", serial, "reverse", "--list"]).await {
        if mapping(&routes) == Some(SOCKET) {
            let _ = run(&["-s", serial, "reverse", "--remove", SOCKET]).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_excludes_wireless_emulators_and_untrusted_serials() {
        let devices = parse_devices("List of devices attached\nABC123 device product:cheetah model:Pixel_7_Pro transport_id:1\nXYZ unauthorized\n192.168.1.2:5555 device model:Wireless\nadb-abc._adb-tls-connect._tcp device\nemulator-5554 device\n-bad device\n");
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].name, "Pixel 7 Pro");
        assert!(devices[0].authorized);
        assert!(!devices[1].authorized);
    }
    #[test]
    fn only_the_owned_reverse_mapping_is_recognized() {
        assert_eq!(
            mapping("UsbFfs tcp:8080 tcp:3000\nUsbFfs tcp:43827 tcp:43827\n"),
            Some(SOCKET)
        );
        assert_eq!(mapping("UsbFfs tcp:43827 tcp:9999"), Some("tcp:9999"));
        assert_eq!(mapping("UsbFfs tcp:8080 tcp:43827"), None);
    }
}
