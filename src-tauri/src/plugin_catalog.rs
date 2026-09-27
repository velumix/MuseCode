//! A small metadata directory. No startup I/O and no plugin code is evaluated.
use crate::{
    plugin_github::{self, Origin},
    plugins::{self, Manifest},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    repository: String,
    commit: String,
    manifest: Manifest,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Catalog {
    schema_version: u32,
    plugins: Vec<Entry>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct View {
    catalog: Catalog,
    fetched_at: u64,
    notice: Option<String>,
}
#[derive(Default)]
struct Cache {
    view: Option<View>,
    last_attempt: u64,
}
pub struct Store {
    path: PathBuf,
    cache: Mutex<Cache>,
}
fn validate(catalog: &Catalog) -> Result<(), String> {
    if catalog.schema_version != 1 || catalog.plugins.len() > 500 {
        return Err("Unsupported plugin directory format.".into());
    }
    let mut ids = HashSet::new();
    let mut repos = HashSet::new();
    for entry in &catalog.plugins {
        if !plugin_github::valid_origin(&Origin {
            repository: entry.repository.clone(),
            commit: entry.commit.clone(),
        }) || !ids.insert(&entry.manifest.id)
            || !repos.insert(&entry.repository)
        {
            return Err("The directory contains invalid or duplicate plugins.".into());
        }
        plugins::validate(&entry.manifest)?;
    }
    Ok(())
}
fn parse(text: &str) -> Result<Catalog, String> {
    if text.len() > 1024 * 1024 {
        return Err("Plugin directory exceeds its size limit.".into());
    }
    let catalog: Catalog =
        serde_json::from_str(text).map_err(|_| "Cannot read the plugin directory.".to_string())?;
    validate(&catalog)?;
    Ok(catalog)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
impl Store {
    fn load(&self) -> View {
        let saved = (|| {
            let file = fs::File::open(&self.path).ok()?;
            let mut text = String::new();
            file.take(1024 * 1024 + 4097)
                .read_to_string(&mut text)
                .ok()?;
            if text.len() > 1024 * 1024 + 4096 {
                return None;
            }
            let mut view: View = serde_json::from_str(&text).ok()?;
            validate(&view.catalog).ok()?;
            view.notice = None;
            Some(view)
        })();
        saved.unwrap_or_else(|| View {
            catalog: parse(include_str!("../../src/assets/plugin-catalog.json"))
                .expect("bundled catalog"),
            fetched_at: 0,
            notice: None,
        })
    }
    fn get(&self, refresh: bool, fetch: impl FnOnce() -> Result<String, String>) -> View {
        let mut cache = self.cache.lock().unwrap();
        if cache.view.is_none() {
            cache.view = Some(self.load());
        }
        let time = now();
        let current = cache.view.as_ref().unwrap().clone();
        let fresh = current.fetched_at > 0
            && time >= current.fetched_at
            && time - current.fetched_at < 3600;
        if !refresh
            && (fresh || (cache.last_attempt > 0 && time.saturating_sub(cache.last_attempt) < 30))
        {
            return current.clone();
        }
        cache.last_attempt = time;
        let view = match fetch().and_then(|text| parse(&text)) {
            Ok(catalog) => {
                let mut view = View {
                    catalog,
                    fetched_at: time,
                    notice: None,
                };
                if crate::storage::write_json(&self.path, &view).is_err() {
                    view.notice =
                        Some("Directory loaded, but its offline copy could not be saved.".into());
                }
                view
            }
            Err(_) => {
                let mut view = current.clone();
                view.notice=Some(if view.fetched_at==0{"Could not refresh the directory. Showing the included starter list; try Refresh when connected."}else{"Could not refresh the directory. Showing your saved list; installed plugins still work."}.into());
                view
            }
        };
        cache.view = Some(view.clone());
        view
    }
}
pub fn setup(app: &tauri::AppHandle) {
    let path = std::env::var_os("MUSE_CODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| app.path().app_config_dir().expect("app config directory"))
        .join("plugin-directory.json");
    app.manage(Store {
        path,
        cache: Mutex::new(Cache::default()),
    });
}
#[tauri::command]
pub async fn plugins_catalog(app: tauri::AppHandle, refresh: bool) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Store>().get(refresh, plugin_github::directory)
    })
    .await
    .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_validation_and_cache_preserve_last_good_copy() {
        let text = include_str!("../../src/assets/plugin-catalog.json");
        let mut c = parse(text).unwrap();
        c.plugins.push(c.plugins[0].clone());
        assert!(validate(&c).is_err());
        let root = std::env::temp_dir().join(format!("velum-catalog-{}", uuid::Uuid::new_v4()));
        let store = Store {
            path: root.join("catalog.json"),
            cache: Mutex::new(Cache::default()),
        };
        let fallback = store.get(false, || Err("Offline".into()));
        assert!(fallback.notice.is_some());
        let live = store.get(true, || Ok(text.into()));
        assert!(live.notice.is_none());
        store.get(false, || panic!("fresh catalog should not fetch"));
        let failed = store.get(true, || Ok("invalid".into()));
        assert_eq!(failed.catalog.plugins.len(), live.catalog.plugins.len());
        assert!(failed.notice.is_some());
        let reopened = Store {
            path: store.path.clone(),
            cache: Mutex::new(Cache::default()),
        };
        assert!(reopened
            .get(false, || panic!("disk cache is fresh"))
            .notice
            .is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
