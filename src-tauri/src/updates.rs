//! Signed GitHub releases are checked and downloaded outside the WebView.
//! Installation is an explicit restart, admitted only while agent work is idle.
#[cfg(windows)]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct Preferences {
    automatic: bool,
    install_error: Option<String>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            automatic: true,
            install_error: None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Idle,
    Checking,
    Current,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
}

#[derive(Clone, serde::Serialize)]
pub struct Status {
    revision: u64,
    supported: bool,
    automatic: bool,
    current_version: String,
    phase: Phase,
    version: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    checked_at: Option<String>,
    error: Option<String>,
}

#[cfg(windows)]
struct Pending {
    update: tauri_plugin_updater::Update,
    bytes: Option<Vec<u8>>,
}

pub struct UpdateState {
    path: PathBuf,
    status: Mutex<Status>,
    // This lock serializes checks, downloads and installation. Settings can
    // still change while network operations are in flight.
    #[cfg(windows)]
    pending: tokio::sync::Mutex<Option<Pending>>,
    #[cfg(windows)]
    cleaned_up: Arc<AtomicBool>,
}

fn publish(app: &AppHandle, change: impl FnOnce(&mut Status)) -> Status {
    let state = app.state::<UpdateState>();
    let mut current = state.status.lock().unwrap();
    change(&mut current);
    current.revision += 1;
    let status = current.clone();
    // Emit under the lock so a late progress event cannot replace Ready.
    let _ = app.emit("app-update-status", &status);
    status
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(windows)]
    app.plugin(tauri_plugin_updater::Builder::new().build())?;
    let directory = std::env::var_os("MUSE_CODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_config_dir()?);
    let path = directory.join("updates.json");
    let preferences: Preferences = std::fs::read(&path)
        .ok()
        .filter(|bytes| bytes.len() <= 4096)
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let supported = cfg!(windows)
        && !cfg!(debug_assertions)
        && matches!(
            tauri::utils::platform::bundle_type(),
            Some(tauri::utils::config::BundleType::Nsis)
        )
        && std::env::var_os("VELUM_ISOLATED_TEST").is_none();
    app.manage(UpdateState {
        path,
        status: Mutex::new(Status {
            revision: 0,
            supported,
            automatic: preferences.automatic,
            current_version: app.package_info().version.to_string(),
            phase: if preferences.install_error.is_some() {
                Phase::Error
            } else {
                Phase::Idle
            },
            version: None,
            downloaded: 0,
            total: None,
            checked_at: None,
            error: preferences.install_error,
        }),
        #[cfg(windows)]
        pending: tokio::sync::Mutex::new(None),
        #[cfg(windows)]
        cleaned_up: Arc::new(AtomicBool::new(false)),
    });
    #[cfg(windows)]
    if supported {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Startup and conversation recovery never wait for GitHub.
            tokio::time::sleep(Duration::from_secs(30)).await;
            loop {
                if app.state::<UpdateState>().status.lock().unwrap().automatic {
                    let _ = check(&app).await;
                }
                tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
            }
        });
    }
    Ok(())
}

fn require_supported(state: &UpdateState) -> Result<(), String> {
    if state.status.lock().unwrap().supported {
        Ok(())
    } else {
        Err("App updates are available in the installed Windows release.".into())
    }
}

#[tauri::command]
pub fn updates_status(state: State<UpdateState>) -> Status {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn updates_set_automatic(app: AppHandle, automatic: bool) -> Result<Status, String> {
    let state = app.state::<UpdateState>();
    require_supported(&state)?;
    let mut status = state.status.lock().unwrap();
    let preferences = Preferences {
        automatic,
        ..Preferences::default()
    };
    crate::storage::write_json(&state.path, &preferences)?;
    status.automatic = automatic;
    status.revision += 1;
    let result = status.clone();
    let _ = app.emit("app-update-status", &result);
    drop(status);
    #[cfg(windows)]
    if automatic {
        tauri::async_runtime::spawn(async move {
            let _ = check(&app).await;
        });
    }
    Ok(result)
}

#[cfg(windows)]
fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let cleanup = app.clone();
    let cleaned_up = Arc::clone(&app.state::<UpdateState>().cleaned_up);
    app.updater_builder()
        .timeout(Duration::from_secs(5 * 60))
        .header("Cache-Control", "no-cache")
        .map_err(|error| error.to_string())?
        .on_before_exit(move || {
            crate::shutdown(&cleanup);
            cleaned_up.store(true, Ordering::SeqCst);
        })
        .build()
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
async fn check(app: &AppHandle) -> Result<Status, String> {
    let state = app.state::<UpdateState>();
    require_supported(&state)?;
    let mut pending = state
        .pending
        .try_lock()
        .map_err(|_| "An update operation is already in progress.")?;
    if pending
        .as_ref()
        .is_some_and(|update| update.bytes.is_some())
    {
        return Ok(state.status.lock().unwrap().clone());
    }
    publish(app, |s| {
        s.phase = Phase::Checking;
        s.error = None;
    });
    let result = async {
        let updater = updater(app)?;
        let update = tokio::time::timeout(Duration::from_secs(30), updater.check())
            .await
            .map_err(|_| "GitHub did not respond within 30 seconds. Try again later.".to_string())?
            .map_err(|error| match error {
                tauri_plugin_updater::Error::ReleaseNotFound =>
                    "The GitHub update feed is not available yet. Try again after a signed release is published.".into(),
                _ => format!("Could not check GitHub for updates: {error}"),
            })?;
        publish(app, |s| s.checked_at = Some(chrono::Utc::now().to_rfc3339()));
        let Some(update) = update else {
            *pending = None;
            return Ok(publish(app, |s| {
                s.phase = Phase::Current;
                s.version = None;
                s.downloaded = 0;
                s.total = None;
            }));
        };
        // Accept installers from this release repository only. The plugin
        // additionally verifies the bundled public key before returning bytes.
        if !update.download_url.as_str().starts_with(
            "https://github.com/velumix/VelumCode/releases/download/",
        ) {
            return Err("The update points outside the Velum Code GitHub releases.".into());
        }
        publish(app, |s| {
            s.phase = Phase::Available;
            s.version = Some(update.version.clone());
            s.downloaded = 0;
            s.total = None;
        });
        *pending = Some(Pending { update, bytes: None });
        if state.status.lock().unwrap().automatic {
            download(app, pending.as_mut().unwrap()).await
        } else {
            Ok(state.status.lock().unwrap().clone())
        }
    }.await;
    result.inspect_err(|error| {
        publish(app, |s| {
            s.phase = Phase::Error;
            s.error = Some(error.clone());
        });
    })
}

#[cfg(windows)]
async fn download(app: &AppHandle, pending: &mut Pending) -> Result<Status, String> {
    if pending.bytes.is_some() {
        return Ok(app.state::<UpdateState>().status.lock().unwrap().clone());
    }
    publish(app, |s| {
        s.phase = Phase::Downloading;
        s.error = None;
        s.downloaded = 0;
        s.total = None;
    });
    let mut downloaded = 0_u64;
    let mut last_progress = std::time::Instant::now();
    let result = pending
        .update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                // Avoid flooding the WebView on fast connections.
                if last_progress.elapsed() >= Duration::from_millis(250)
                    || Some(downloaded) == total
                {
                    publish(app, |s| {
                        s.downloaded = downloaded;
                        s.total = total;
                    });
                    last_progress = std::time::Instant::now();
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            let length = bytes.len() as u64;
            pending.bytes = Some(bytes);
            Ok(publish(app, |s| {
                s.phase = Phase::Ready;
                s.downloaded = length;
                s.total = Some(length);
            }))
        }
        Err(error) => {
            let message = format!("Could not download or verify the update: {error}");
            publish(app, |s| {
                s.phase = Phase::Error;
                s.error = Some(message.clone());
            });
            Err(message)
        }
    }
}

#[tauri::command]
pub async fn updates_check(app: AppHandle) -> Result<Status, String> {
    #[cfg(windows)]
    return check(&app).await;
    #[cfg(not(windows))]
    {
        require_supported(&app.state::<UpdateState>())?;
        unreachable!()
    }
}

#[tauri::command]
pub async fn updates_download(app: AppHandle) -> Result<Status, String> {
    let state = app.state::<UpdateState>();
    require_supported(&state)?;
    #[cfg(windows)]
    {
        let mut pending = state
            .pending
            .try_lock()
            .map_err(|_| "An update operation is already in progress.")?;
        download(&app, pending.as_mut().ok_or("Check for an update first.")?).await
    }
    #[cfg(not(windows))]
    unreachable!()
}

#[tauri::command]
pub async fn updates_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    require_supported(&state)?;
    #[cfg(windows)]
    {
        let pending = state
            .pending
            .try_lock()
            .map_err(|_| "An update operation is already in progress.")?;
        let pending = pending.as_ref().ok_or("Download an update first.")?;
        let bytes = pending
            .bytes
            .as_ref()
            .ok_or("The update has not finished downloading.")?;
        let agents = app.state::<crate::runner::AgentState>();
        agents.begin_update()?;
        if let Err(error) = crate::history::flush_before_update(&app) {
            agents.cancel_update();
            return Err(format!(
                "Could not save conversations before restarting: {error}"
            ));
        }
        let saved = {
            let status = state.status.lock().unwrap();
            crate::storage::write_json(
                &state.path,
                &Preferences {
                    automatic: status.automatic,
                    install_error: None,
                },
            )
        };
        if let Err(error) = saved {
            agents.cancel_update();
            return Err(format!(
                "Could not save update settings before restarting: {error}"
            ));
        }
        publish(&app, |s| {
            s.phase = Phase::Installing;
            s.error = None;
        });
        // NSIS installs at the current app location, preserves app data and
        // relaunches. The plugin's before-exit hook performs native cleanup.
        if let Err(error) = pending.update.install(bytes) {
            agents.cancel_update();
            let message = format!("Could not start the update installer: {error}");
            publish(&app, |s| {
                s.phase = Phase::Ready;
                s.error = Some(message.clone());
            });
            if state.cleaned_up.load(Ordering::SeqCst) {
                // ShellExecute can fail after the plugin's cleanup hook. Open
                // a fresh instance of the current version to restore native
                // services and recovered tabs instead of keeping drained state.
                let automatic = state.status.lock().unwrap().automatic;
                let _ = crate::storage::write_json(
                    &state.path,
                    &Preferences {
                        automatic,
                        install_error: Some(message),
                    },
                );
                app.restart();
            }
            return Err(message);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    unreachable!()
}
