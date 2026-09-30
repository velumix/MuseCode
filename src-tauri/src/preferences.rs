//! Device-local UI preferences. Atomic writes leave the previous profile intact
//! on failure; serialization prevents an older slider update winning a race.
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

const MAX_BYTES: usize = 32768;
pub struct PreferenceStore {
    path: PathBuf,
    access: Mutex<()>,
}
impl PreferenceStore {
    fn load(&self) -> Result<Option<Value>, String> {
        let _guard = self
            .access
            .lock()
            .map_err(|_| "Settings lock unavailable")?;
        if !self.path.exists() {
            return Ok(None);
        }
        if fs::metadata(&self.path).map_err(|e| e.to_string())?.len() > MAX_BYTES as u64 {
            return Err("Settings file exceeds 32 KB".into());
        }
        let bytes = fs::read(&self.path).map_err(|e| e.to_string())?;
        let profile: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        validate(&profile)?;
        Ok(Some(profile))
    }
    fn save(&self, profile: &Value) -> Result<(), String> {
        validate(profile)?;
        let _guard = self
            .access
            .lock()
            .map_err(|_| "Settings lock unavailable")?;
        crate::storage::write_json(&self.path, profile)
    }
}
fn validate(profile: &Value) -> Result<(), String> {
    if profile.get("version").and_then(Value::as_u64) != Some(1)
        || !profile.get("settings").is_some_and(Value::is_object)
    {
        return Err("Expected a version 1 Velum settings profile".into());
    }
    if serde_json::to_vec_pretty(profile)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_BYTES
    {
        return Err("Settings profile exceeds 32 KB".into());
    }
    Ok(())
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = std::env::var_os("MUSE_CODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_config_dir()?);
    app.manage(PreferenceStore {
        path: config.join("appearance.json"),
        access: Mutex::new(()),
    });
    Ok(())
}
#[tauri::command]
pub fn preferences_load(state: State<'_, PreferenceStore>) -> Result<Option<Value>, String> {
    state.load()
}
#[tauri::command]
pub fn preferences_save(state: State<'_, PreferenceStore>, profile: Value) -> Result<(), String> {
    state.save(&profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Fixture(PreferenceStore);
    impl Fixture {
        fn new() -> Self {
            Self(PreferenceStore {
                path: std::env::temp_dir()
                    .join(format!("velum-appearance-{}.json", uuid::Uuid::new_v4())),
                access: Mutex::new(()),
            })
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0.path);
        }
    }
    #[test]
    fn persists_latest_profile_without_affecting_other_settings() {
        let store = Fixture::new();
        assert_eq!(store.0.load().unwrap(), None);
        let first = json!({"version":1,"settings":{"theme":"aurora","blur":20}});
        store.0.save(&first).unwrap();
        assert_eq!(store.0.load().unwrap(), Some(first));
        let latest = json!({"version":1,"settings":{"theme":"linen","blur":0}});
        store.0.save(&latest).unwrap();
        assert_eq!(store.0.load().unwrap(), Some(latest));
    }
    #[test]
    fn invalid_and_oversized_profiles_preserve_the_saved_file() {
        let store = Fixture::new();
        let valid = json!({"version":1,"settings":{"theme":"graphite"}});
        store.0.save(&valid).unwrap();
        for invalid in [
            json!({"version":2,"settings":{}}),
            json!({"version":1,"settings":[]}),
            json!({"version":1,"settings":{"unknown":"x".repeat(MAX_BYTES)}}),
        ] {
            assert!(store.0.save(&invalid).is_err());
            assert_eq!(store.0.load().unwrap(), Some(valid.clone()));
        }
    }
    #[test]
    fn corrupt_files_are_reported_and_preserved() {
        let store = Fixture::new();
        fs::write(&store.0.path, b"not json").unwrap();
        assert!(store.0.load().is_err());
        assert_eq!(fs::read(&store.0.path).unwrap(), b"not json");
        fs::write(&store.0.path, vec![b'x'; MAX_BYTES + 1]).unwrap();
        assert!(store.0.load().unwrap_err().contains("32 KB"));
    }
}
