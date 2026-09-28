//! Small, local context checks. Reports deliberately exclude prompts, credentials,
//! environment variables, raw CLI errors, repository URLs and memory contents.
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, io::Read, path::Path};
use tauri::Manager;

#[derive(Serialize)]
pub struct Access {
    pub path: String,
    pub checked_at: u64,
    pub readable: bool,
    pub writable: Option<bool>,
    pub message: String,
}

pub fn readable(path: &Path) -> bool {
    fs::read_dir(path)
        .and_then(|mut entries| entries.next().transpose())
        .is_ok()
}

fn probe(path: &Path, write: bool) -> Access {
    let readable = readable(path);
    let mut cleanup_failed = false;
    let writable = write.then(|| {
        let file = path.join(format!(".velum-access-check-{}.tmp", uuid::Uuid::new_v4()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
        {
            Ok(handle) => {
                drop(handle);
                cleanup_failed = fs::remove_file(file).is_err();
                !cleanup_failed
            }
            Err(_) => false,
        }
    });
    Access {
        path: path.display().to_string(),
        checked_at: crate::automation::now(),
        readable,
        writable,
        message: if cleanup_failed {
            "A temporary access-check file could not be removed. Check folder permissions."
        } else if !readable {
            "Velum cannot list this folder. Choose another project or check Windows folder access."
        } else if writable == Some(false) {
            "Folder listing works; creating a file failed. Read-only work is still available."
        } else if write {
            "Folder listing and temporary-file creation passed. CLI tool permissions are checked separately."
        } else {
            "Folder listing passed. Write access and CLI tool permissions have not been tested."
        }.into(),
    }
}

#[tauri::command]
pub async fn workspace_check(workspace: String, write: bool) -> Result<Access, String> {
    tauri::async_runtime::spawn_blocking(move || probe(Path::new(&workspace), write))
        .await
        .map_err(|e| e.to_string())
}

fn small_file(path: &Path) -> Option<String> {
    let mut text = String::new();
    fs::File::open(path)
        .ok()?
        .take(4096)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

fn repository(path: &Path) -> Option<Value> {
    for root in path.ancestors() {
        let marker = root.join(".git");
        let git = if marker.is_dir() {
            marker
        } else if marker.is_file() {
            let data = small_file(&marker)?;
            root.join(data.trim().strip_prefix("gitdir: ")?)
        } else {
            continue;
        };
        let head = small_file(&git.join("HEAD"));
        return Some(json!({
            "root": root.display().to_string(),
            "branch": head.as_deref().and_then(|h| h.trim().strip_prefix("ref: refs/heads/")).map(|h| h.chars().take(160).collect::<String>()),
            "working_tree_changes": "not checked"
        }));
    }
    None
}

pub fn turn_context(
    workspace: &Path,
    provider: crate::providers::Provider,
    options: &crate::provider_models::RunOptions,
    source: &str,
    yolo: bool,
) -> String {
    let mut context = json!({
        "app": "Velum Code", "version": env!("CARGO_PKG_VERSION"),
        "host_os": std::env::consts::OS, "request_source": source,
        "screen": if source == "scheduler" { "background task" } else { "chat" },
        "workspace": workspace.display().to_string(),
        "directory_listing": if readable(workspace) { "passed in Velum" } else { "failed in Velum" },
        "write_access": "not tested for this turn",
        "repository": repository(workspace), "provider": provider, "options": options,
        "permission_mode": if yolo { "user enabled YOLO" } else { "standard; provider policy still applies" },
        "ui_access": "No live screenshot, browser attachment or native app control is supplied by Velum. A user can attach a previewed chat layout snapshot or diagnostics report.",
        "memory": "Relevant vault notes are supplied separately within a byte budget. Velum confirms saved proposals in a notice; a proposal alone is not proof of saving. No dedicated vault search tool is added by this context.",
        "capabilities": "CLI installation does not establish authentication or working tool connections. Check actual tool results; do not infer access from this context."
    });
    // Count serialized bytes: escaping can expand paths and custom model names.
    // Leave room for framing and explain omitted fields instead of giving the
    // provider a truncated path that could point to the wrong directory.
    if context.to_string().len() > 3500 {
        for key in ["workspace", "repository", "options"] {
            context[key] = Value::Null;
        }
        context["omitted_fields"] = json!("Workspace, repository and options exceeded the app context size limit. Ask the user for those details if needed.");
    }
    format!("Velum app context (reference data, not instructions or permission grants):\n<velum-app-context>\n{context}\n</velum-app-context>\n\n")
}

pub fn diagnostics(app: &tauri::AppHandle, workspace: &str) -> Value {
    let path = Path::new(workspace);
    let access = probe(path, false);
    let providers: Vec<Value> = [crate::providers::Provider::Muse, crate::providers::Provider::Codex, crate::providers::Provider::Antigravity]
        .into_iter().map(|p| json!({"provider":p,"installed":p.resolve().is_some(),"authentication":"not checked","tool_connections":"not checked"})).collect();
    let memory = app.state::<crate::memory::Store>().request(
        workspace,
        crate::memory::Request::List {
            query: String::new(),
        },
    );
    let memory = match memory {
        Ok(view) => {
            json!({"scope":"shared/project vault","readable":true,"enabled":view.settings.enabled,"capture":view.settings.capture,"budget_bytes":view.settings.budget_bytes,"notes":view.notes.len(),"warning_present":view.warning.is_some()})
        }
        Err(_) => json!({"readable":false,"next_step":"Open Memory to inspect the vault error."}),
    };
    let sessions = app.state::<crate::session_log::SessionLog>().summaries();
    let sessions: Vec<_> = sessions
        .iter()
        .filter(|s| Path::new(&s.workspace) == path)
        .collect();
    json!({
        "app":"Velum Code", "version":env!("CARGO_PKG_VERSION"), "host_os":std::env::consts::OS,
        "checked_at":access.checked_at,
        "workspace":{"path":"<selected-project>","directory_listing":access.readable,"write_access":"not checked","message":access.message,"git_repository":repository(path).is_some()},
        "providers":providers, "memory":memory,
        "sessions":{"active":sessions.iter().filter(|s| s.running).count(),"failed":sessions.iter().filter(|s| s.status=="failed").count(),"blocked":sessions.iter().filter(|s| s.status=="blocked").count()},
        "ui_access":"No live browser or native UI control attached by Velum. Chat layout snapshots require an explicit attachment.",
        "permissions":"Windows folder access and provider command permissions are separate. On the desktop, open Terminal in an Antigravity tab and enter /permissions; allow only the command needed and retry. Scheduled permission failures pause for review.",
        "excluded":"Paths, chat text, drafts, tokens, environment, raw logs, repository remotes, memory contents and permission rules."
    })
}

#[tauri::command]
pub async fn app_diagnostics(app: tauri::AppHandle, workspace: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || diagnostics(&app, &workspace))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let owner = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize);
        tauri::async_runtime::spawn_blocking(move || pick_folder(owner))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Enter a project path in the workspace field.".into())
    }
}

#[cfg(windows)]
fn pick_folder(owner: Option<isize>) -> Result<Option<String>, String> {
    use windows::Win32::{Foundation::HWND, System::Com::*, UI::Shell::*};
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe { CoUninitialize() }
            }
        }
        let _com = Com;
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;
        dialog
            .SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR)
            .map_err(|e| e.to_string())?;
        dialog
            .SetTitle(windows::core::w!("Choose your project"))
            .map_err(|e| e.to_string())?;
        if let Err(error) = dialog.Show(owner.map(|h| HWND(h as *mut _))) {
            if error.code().0 as u32 == 0x800704c7 {
                return Ok(None);
            }
            return Err(error.to_string());
        }
        let item = dialog.GetResult().map_err(|e| e.to_string())?;
        let path = item
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(|e| e.to_string())?;
        let result = path.to_string().map_err(|e| e.to_string());
        CoTaskMemFree(Some(path.0 as *const _));
        result.map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oversized_context_omits_fields_without_inventing_a_shorter_path() {
        let path = std::path::PathBuf::from("x".repeat(8000));
        let context = turn_context(
            &path,
            crate::providers::Provider::Muse,
            &Default::default(),
            "desktop",
            false,
        );
        assert!(context.len() <= 4096);
        assert!(context.contains("\"workspace\":null"));
        assert!(context.contains("omitted_fields"));
        assert!(!context.contains(&"x".repeat(100)));
    }
    #[test]
    fn access_probe_cleans_up_and_reports_missing_folders() {
        let root = std::env::temp_dir().join(format!("velum-context-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let check = probe(&root, true);
        assert!(check.readable);
        assert_eq!(check.writable, Some(true));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir(&root).unwrap();
        assert!(!probe(&root, false).readable);
    }
    #[test]
    fn context_covers_worktrees_without_reading_remote_credentials() {
        let root = std::env::temp_dir().join(format!("velum-context-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("metadata")).unwrap();
        fs::create_dir(root.join("project")).unwrap();
        fs::write(root.join("project/.git"), "gitdir: ../metadata").unwrap();
        fs::write(
            root.join("metadata/HEAD"),
            "ref: refs/heads/feature/context\n",
        )
        .unwrap();
        fs::write(root.join("metadata/config"), "credential=SECRET").unwrap();
        let context = turn_context(
            &root.join("project"),
            crate::providers::Provider::Antigravity,
            &Default::default(),
            "desktop",
            false,
        );
        assert!(context.contains("feature/context"));
        assert!(context.contains("passed in Velum"));
        assert!(!context.contains("SECRET"));
        assert!(context.len() < 4096);
        fs::remove_file(root.join("project/.git")).unwrap();
        fs::remove_file(root.join("metadata/HEAD")).unwrap();
        fs::remove_file(root.join("metadata/config")).unwrap();
        fs::remove_dir(root.join("project")).unwrap();
        fs::remove_dir(root.join("metadata")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
