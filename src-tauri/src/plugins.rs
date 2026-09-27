//! Local command plugins. Only metadata is loaded at startup; JavaScript runs in
//! an opaque-origin browser worker and reaches native code through this allowlist.
use crate::plugin_github::{self, Origin};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};

const MAX_SOURCE: usize = 512 * 1024;
const MAX_FILE: usize = 128 * 1024;
const MAX_PLUGINS: usize = 32;
const PERMISSIONS: &[&str] = &["workspace.read", "conversation.read", "storage"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Manifest {
    pub api_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub entry: String,
    pub permissions: Vec<String>,
    pub commands: Vec<Command>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Installed {
    pub manifest: Manifest,
    pub digest: String,
    pub enabled: bool,
    #[serde(default)]
    pub origin: Option<Origin>,
}

#[derive(Clone, Serialize)]
pub struct Preview {
    pub manifest: Manifest,
    pub digest: String,
    pub bytes: usize,
    pub origin: Origin,
}

pub struct PluginState {
    root: PathBuf,
    installed: Mutex<HashMap<String, Installed>>,
    storage_lock: Mutex<()>,
    previews: Mutex<HashMap<String, (Preview, String)>>,
}

fn valid_id(id: &str) -> bool {
    (3..=64).contains(&id.len())
        && id.as_bytes()[0].is_ascii_lowercase()
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
        && !id.contains("..")
        && !id.ends_with('.')
        && ![
            "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
            "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
        ]
        .contains(&id.split('.').next().unwrap_or(""))
}

fn validate(m: &Manifest) -> Result<(), String> {
    if m.api_version != 1 {
        return Err("This plugin needs a different SDK version. Supported API: 1.".into());
    }
    if !valid_id(&m.id) || m.entry != "index.js" {
        return Err("Use a valid plugin ID and a bundled index.js entry.".into());
    }
    for (value, limit) in [
        (&m.name, 80),
        (&m.version, 40),
        (&m.description, 500),
        (&m.author, 120),
    ] {
        if value.trim().is_empty() || value.len() > limit || value.chars().any(char::is_control) {
            return Err(
                "Plugin details are empty, too long, or contain control characters.".into(),
            );
        }
    }
    if m.permissions.len() > PERMISSIONS.len()
        || m.permissions
            .iter()
            .any(|p| !PERMISSIONS.contains(&p.as_str()))
    {
        return Err("This plugin requests an unsupported permission.".into());
    }
    if m.commands.is_empty() || m.commands.len() > 20 {
        return Err("Plugins must declare between 1 and 20 commands.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for command in &m.commands {
        if !valid_id(&command.id)
            || !ids.insert(&command.id)
            || command.title.trim().is_empty()
            || command.title.len() > 100
            || command.description.len() > 500
        {
            return Err("Invalid or duplicate plugin command.".into());
        }
    }
    Ok(())
}

fn read_bounded(path: &Path, limit: usize) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Expected a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err(format!("File exceeds the {limit} byte limit."));
    }
    String::from_utf8(bytes).map_err(|_| "Only UTF-8 text files are supported.".into())
}

fn child(root: &Path, relative: &str) -> Result<PathBuf, String> {
    // Reject Windows ADS, rooted paths, traversal and symlinks outside the workspace.
    if relative.contains(':')
        || relative.contains('\\')
        || relative.contains('\0')
        || Path::new(relative)
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err("Use a relative path inside the workspace.".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err("That path leaves the workspace.".into());
    }
    Ok(path)
}

fn digest(manifest: &Manifest, source: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(manifest).unwrap());
    hash.update(source.as_bytes());
    format!("{:x}", hash.finalize())
}

fn package(repository: &str) -> Result<(Preview, String), String> {
    let (origin, text, source) = plugin_github::package(repository)?;
    let manifest: Manifest =
        serde_json::from_str(&text).map_err(|e| format!("Invalid velum-plugin.json: {e}"))?;
    validate(&manifest)?;
    let digest = digest(&manifest, &source);
    Ok((
        Preview {
            manifest,
            digest,
            bytes: source.len(),
            origin,
        },
        source,
    ))
}

impl PluginState {
    fn install(&self, repository: &str, reviewed_digest: &str) -> Result<(), String> {
        let (preview, source) = self
            .previews
            .lock()
            .unwrap()
            .get(reviewed_digest)
            .cloned()
            .ok_or("Review this plugin again before installing.")?;
        if preview.origin.repository != plugin_github::repository(repository)? {
            return Err("Repository changed after review. Review it again.".into());
        }
        let mut installed = self.installed.lock().unwrap();
        let old = installed.get(&preview.manifest.id);
        if old
            .and_then(|p| p.origin.as_ref())
            .is_some_and(|o| o.repository != preview.origin.repository)
        {
            return Err("Another repository already uses this plugin ID. Remove the existing plugin before switching publishers.".into());
        }
        let enabled = old.map(|p| p.enabled).unwrap_or(true);
        if installed.len() >= MAX_PLUGINS && !installed.contains_key(&preview.manifest.id) {
            return Err("The 32 plugin limit has been reached.".into());
        }
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let plugin = Installed {
            manifest: preview.manifest,
            digest: preview.digest,
            enabled,
            origin: Some(preview.origin),
        };
        // Content-addressed source ensures the reviewed manifest and code stay paired.
        crate::storage::write_bytes(
            &self.root.join(format!("{}.js", plugin.digest)),
            source.as_bytes(),
        )?;
        crate::storage::write_json(
            &self.root.join(format!("{}.json", plugin.manifest.id)),
            &plugin,
        )?;
        let old = installed.insert(plugin.manifest.id.clone(), plugin.clone());
        if let Some(old) = old.filter(|old| old.digest != plugin.digest) {
            let _ = fs::remove_file(self.root.join(format!("{}.js", old.digest)));
        }
        self.previews.lock().unwrap().remove(reviewed_digest);
        Ok(())
    }

    fn load(root: PathBuf) -> Self {
        let mut installed = HashMap::new();
        if let Ok(files) = fs::read_dir(&root) {
            for file in files.flatten().take(MAX_PLUGINS * 4) {
                if file.path().extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let Ok(text) = read_bounded(&file.path(), 32 * 1024) else {
                    continue;
                };
                let Ok(mut plugin) = serde_json::from_str::<Installed>(&text) else {
                    continue;
                };
                if validate(&plugin.manifest).is_ok()
                    && file.file_name().to_string_lossy() == format!("{}.json", plugin.manifest.id)
                    && installed.len() < MAX_PLUGINS
                {
                    if plugin
                        .origin
                        .as_ref()
                        .is_none_or(|o| !plugin_github::valid_origin(o))
                    {
                        plugin.enabled = false;
                    }
                    installed.insert(plugin.manifest.id.clone(), plugin);
                }
            }
        }
        Self {
            root,
            installed: Mutex::new(installed),
            storage_lock: Mutex::new(()),
            previews: Mutex::new(HashMap::new()),
        }
    }

    fn permitted(&self, id: &str, permission: &str) -> Result<Installed, String> {
        let installed = self.installed.lock().unwrap();
        let plugin = installed.get(id).ok_or("Plugin is not installed.")?;
        if !plugin.enabled {
            return Err("Plugin is disabled.".into());
        }
        if !permission.is_empty() && !plugin.manifest.permissions.iter().any(|p| p == permission) {
            return Err(format!("Permission required: {permission}"));
        }
        Ok(plugin.clone())
    }
}

pub fn setup(app: &tauri::AppHandle) {
    let root = std::env::var_os("MUSE_CODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| app.path().app_config_dir().expect("app config directory"))
        .join("plugins");
    app.manage(PluginState::load(root));
}

#[tauri::command]
pub fn plugins_list(state: State<PluginState>) -> Vec<Installed> {
    let mut list: Vec<_> = state.installed.lock().unwrap().values().cloned().collect();
    list.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    list
}

#[tauri::command]
pub async fn plugins_preview(app: tauri::AppHandle, repository: String) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (preview, source) = package(&repository)?;
        let state = app.state::<PluginState>();
        let mut previews = state.previews.lock().unwrap();
        // One review at a time; retain only the bytes shown in the latest review.
        previews.clear();
        previews.insert(preview.digest.clone(), (preview.clone(), source));
        Ok(preview)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugins_install(
    app: tauri::AppHandle,
    repository: String,
    reviewed_digest: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginState>();
        state.install(&repository, &reviewed_digest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn plugins_enable(state: State<PluginState>, id: String, enabled: bool) -> Result<(), String> {
    let mut installed = state.installed.lock().unwrap();
    let current = installed.get_mut(&id).ok_or("Plugin is not installed.")?;
    if enabled
        && current
            .origin
            .as_ref()
            .is_none_or(|o| !plugin_github::valid_origin(o))
    {
        return Err("Link this plugin to its GitHub repository before enabling it.".into());
    }
    let mut next = current.clone();
    next.enabled = enabled;
    crate::storage::write_json(&state.root.join(format!("{id}.json")), &next)?;
    *current = next;
    Ok(())
}

#[tauri::command]
pub fn plugins_remove(state: State<PluginState>, id: String) -> Result<(), String> {
    let mut installed = state.installed.lock().unwrap();
    let plugin = installed.get(&id).ok_or("Plugin is not installed.")?;
    fs::remove_file(state.root.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(state.root.join(format!("{}.js", plugin.digest)));
    let _ = fs::remove_file(state.root.join(format!("{id}.data")));
    installed.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn plugins_source(
    app: tauri::AppHandle,
    id: String,
    command: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginState>();
        let plugin = state.permitted(&id, "")?;
        if !plugin.manifest.commands.iter().any(|c| c.id == command) {
            return Err("Command is not declared in the manifest.".into());
        }
        let source = read_bounded(
            &state.root.join(format!("{}.js", plugin.digest)),
            MAX_SOURCE,
        )?;
        if digest(&plugin.manifest, &source) != plugin.digest {
            return Err(
                "Plugin files have changed. Reinstall the plugin to review the changes.".into(),
            );
        }
        Ok(json!({"manifest":plugin.manifest,"source":source}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugins_call(
    app: tauri::AppHandle,
    id: String,
    workspace: String,
    method: String,
    args: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginState>();
        match method.as_str() {
            "workspace.readText" | "workspace.listFiles" => {
                state.permitted(&id, "workspace.read")?;
                let relative = args.get("path").and_then(Value::as_str).ok_or("A relative path is required.")?;
                let path = child(Path::new(&workspace), relative)?;
                if method == "workspace.readText" { return read_bounded(&path, MAX_FILE).map(Value::String); }
                let mut entries = vec![];
                for entry in fs::read_dir(path).map_err(|e| e.to_string())?.take(201) {
                    if entries.len() == 200 { return Err("Folder has more than 200 entries. Choose a smaller folder.".into()); }
                    let entry = entry.map_err(|e| e.to_string())?;
                    let kind = entry.file_type().map_err(|e| e.to_string())?;
                    entries.push(json!({"name":entry.file_name().to_string_lossy(), "directory":kind.is_dir(), "symlink":kind.is_symlink()}));
                }
                entries.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
                Ok(Value::Array(entries))
            }
            "storage.get" | "storage.set" => {
                state.permitted(&id, "storage")?;
                let _guard = state.storage_lock.lock().unwrap();
                let path = state.root.join(format!("{id}.data"));
                let key = args.get("key").and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 100).ok_or("Storage key must be 1–100 characters.")?;
                let mut data: serde_json::Map<String, Value> = if path.exists() { serde_json::from_str(&read_bounded(&path, 32 * 1024)?).map_err(|e| e.to_string())? } else { Default::default() };
                if method == "storage.get" { return Ok(data.get(key).cloned().unwrap_or(Value::Null)); }
                let value = args.get("value").cloned().unwrap_or(Value::Null);
                if value.is_null() { data.remove(key); } else { data.insert(key.into(), value); }
                if serde_json::to_vec(&data).map_err(|e| e.to_string())?.len() > 32 * 1024 { return Err("Plugin storage is limited to 32 KB.".into()); }
                crate::storage::write_json(&path, &data)?;
                Ok(Value::Null)
            }
            _ => Err("Unsupported plugin API method.".into()),
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installs_reviewed_bytes_and_preserves_settings_without_switching_repositories() {
        let root =
            std::env::temp_dir().join(format!("velum-plugin-review-{}", uuid::Uuid::new_v4()));
        let state = PluginState::load(root.clone());
        let m = manifest();
        let source = "self.VelumPlugin={commands:{}}";
        let mut preview = Preview {
            manifest: m.clone(),
            digest: digest(&m, source),
            bytes: source.len(),
            origin: Origin {
                repository: "velumix/example".into(),
                commit: "a".repeat(40),
            },
        };
        assert!(state.install("velumix/example", "unreviewed").is_err());
        state
            .previews
            .lock()
            .unwrap()
            .insert(preview.digest.clone(), (preview.clone(), source.into()));
        assert!(state.install("other/repo", &preview.digest).is_err());
        state.install("velumix/example", &preview.digest).unwrap();
        assert!(state.previews.lock().unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(root.join(format!("{}.js", preview.digest))).unwrap(),
            source
        );
        fs::write(root.join(format!("{}.data", m.id)), r#"{"setting":true}"#).unwrap();
        state
            .installed
            .lock()
            .unwrap()
            .get_mut(&m.id)
            .unwrap()
            .enabled = false;
        preview.origin.commit = "b".repeat(40);
        preview.manifest.permissions.push("storage".into());
        preview.digest = digest(&preview.manifest, source);
        state
            .previews
            .lock()
            .unwrap()
            .insert(preview.digest.clone(), (preview.clone(), source.into()));
        state.install("velumix/example", &preview.digest).unwrap();
        let installed = PluginState::load(root.clone());
        assert!(!installed.installed.lock().unwrap()[&m.id].enabled);
        assert_eq!(
            fs::read_to_string(root.join(format!("{}.data", m.id))).unwrap(),
            r#"{"setting":true}"#
        );
        preview.origin.repository = "other/repo".into();
        state
            .previews
            .lock()
            .unwrap()
            .insert(preview.digest.clone(), (preview.clone(), source.into()));
        assert!(state
            .install("other/repo", &preview.digest)
            .unwrap_err()
            .contains("Another repository"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn folder_plugins_keep_settings_but_require_repository_migration() {
        let root =
            std::env::temp_dir().join(format!("velum-plugin-legacy-{}", uuid::Uuid::new_v4()));
        let m = manifest();
        crate::storage::write_json(
            &root.join(format!("{}.json", m.id)),
            &Installed {
                manifest: m.clone(),
                digest: digest(&m, "old"),
                enabled: true,
                origin: None,
            },
        )
        .unwrap();
        let state = PluginState::load(root.clone());
        assert!(!state.installed.lock().unwrap()[&m.id].enabled);
        assert!(state.permitted(&m.id, "").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    fn manifest() -> Manifest {
        serde_json::from_str(include_str!(
            "../../examples/project-tools/velum-plugin.json"
        ))
        .unwrap()
    }
    #[test]
    fn rejects_unsupported_permissions_and_duplicate_commands() {
        let mut m = manifest();
        validate(&m).unwrap();
        m.permissions.push("shell".into());
        assert!(validate(&m).is_err());
        m.permissions.pop();
        m.commands.push(m.commands[0].clone());
        assert!(validate(&m).is_err());
        for id in ["../escape", "a/b", "con", "nul.data", "a..b", "C:foo"] {
            assert!(!valid_id(id));
        }
    }
    #[test]
    fn files_are_bounded_and_confined() {
        let root = std::env::temp_dir().join(format!("velum-plugin-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("file.txt"), "hello").unwrap();
        assert_eq!(
            read_bounded(&child(&root, "file.txt").unwrap(), 5).unwrap(),
            "hello"
        );
        assert!(read_bounded(&root.join("file.txt"), 4).is_err());
        for path in ["../file", "/file", "C:/file", "file.txt:stream", "..\\file"] {
            assert!(child(&root, path).is_err());
        }
        fs::remove_file(root.join("file.txt")).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn source_and_permissions_are_bound_to_review_digest() {
        let mut m = manifest();
        let before = digest(&m, "export default {}");
        assert_ne!(before, digest(&m, "export default {changed:true}"));
        m.permissions.clear();
        assert_ne!(before, digest(&m, "export default {}"));
        let state = PluginState {
            root: PathBuf::new(),
            installed: Mutex::new(HashMap::from([(
                m.id.clone(),
                Installed {
                    manifest: m.clone(),
                    digest: before,
                    enabled: false,
                    origin: None,
                },
            )])),
            storage_lock: Mutex::new(()),
            previews: Mutex::new(HashMap::new()),
        };
        assert!(state.permitted(&m.id, "").is_err());
        state
            .installed
            .lock()
            .unwrap()
            .get_mut(&m.id)
            .unwrap()
            .enabled = true;
        assert!(state.permitted(&m.id, "workspace.read").is_err());
    }
}
