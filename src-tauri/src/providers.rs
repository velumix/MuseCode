//! Provider identities are fixed; shell commands never come from the web client.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Muse,
    Codex,
    Antigravity,
}

impl Provider {
    pub fn command(self) -> &'static str {
        match self {
            Self::Muse => "muse",
            Self::Codex => "codex",
            Self::Antigravity => "agy",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Muse => "Muse",
            Self::Codex => "Codex",
            Self::Antigravity => "Antigravity",
        }
    }
    pub fn resolve(self) -> Option<PathBuf> {
        let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            paths.extend([
                local.join("Programs/muse"),
                local.join("Programs/OpenAI/Codex/bin"),
                local.join("agy/bin"),
            ]);
        }
        let extensions = if cfg!(windows) {
            vec![".exe", ".cmd", ".bat", ".com", ".ps1", ""]
        } else {
            vec![""]
        };
        for dir in paths {
            for extension in &extensions {
                let path = dir.join(format!("{}{extension}", self.command()));
                if path.is_file() {
                    return Some(path);
                }
            }
        }
        None
    }
    pub fn missing(self) -> String {
        if self == Self::Antigravity {
            return "Antigravity CLI was not found. Install `agy`, refresh providers, then choose Sign in.".into();
        }
        format!("{} CLI was not found. Install `{}` and sign in using the Terminal view, then try again.", self.label(), self.command())
    }
    pub fn input(self, prompt: &str) -> String {
        if self == Self::Antigravity {
            format!(
                "{}\n",
                serde_json::json!({"event":"user", "message":{"content":prompt}})
            )
        } else {
            prompt.into()
        }
    }
}

#[derive(Serialize)]
pub struct Info {
    id: Provider,
    name: &'static str,
    command: &'static str,
    installed: bool,
    setup_url: &'static str,
}
#[tauri::command]
pub fn provider_status() -> Vec<Info> {
    [Provider::Muse, Provider::Codex, Provider::Antigravity]
        .into_iter()
        .map(|id| Info {
            id,
            name: id.label(),
            command: id.command(),
            installed: id.resolve().is_some(),
            setup_url: match id {
                Provider::Muse => "https://github.com/velumix/VelumCode#providers",
                Provider::Codex => "https://developers.openai.com/codex/cli/",
                Provider::Antigravity => "https://antigravity.google/docs/getting-started?tab=cli",
            },
        })
        .collect()
}

pub fn exec_command(
    provider: Provider,
    path: &Path,
    session: &str,
    workspace: &Path,
    prompt: &Path,
    yolo: bool,
    options: &crate::provider_models::RunOptions,
) -> Result<Command, String> {
    options.validate(provider)?;
    let mut cmd = if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("ps1"))
    {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(path);
        cmd
    } else {
        Command::new(path)
    };
    match provider {
        Provider::Muse => {
            cmd.args(["exec", "--json"]);
            cmd.args(options.args(provider));
            if yolo {
                cmd.arg("--yolo");
            }
            cmd.arg("--session-id")
                .arg(session)
                .arg("--workspace")
                .arg(workspace)
                .arg("--prompt-file")
                .arg(prompt)
                .arg("--user-input-auto-resolve")
                .stdin(Stdio::null());
        }
        Provider::Codex => {
            cmd.args([
                "-c",
                "approval_policy=\"never\"",
                "-c",
                "sandbox_mode=\"workspace-write\"",
            ]);
            // Explicitly bind fresh and resumed turns to the selected project.
            // Do not add the user's home or inherit a previous session's roots.
            cmd.arg("-C").arg(workspace);
            cmd.arg("-c").arg(format!(
                "sandbox_workspace_write.writable_roots={}",
                serde_json::to_string(&[workspace.display().to_string()])
                    .map_err(|e| e.to_string())?
            ));
            cmd.arg("exec");
            if !session.is_empty() {
                cmd.arg("resume");
            }
            cmd.args(["--json", "--skip-git-repo-check"]);
            cmd.args(options.args(provider));
            if yolo {
                cmd.arg("--dangerously-bypass-approvals-and-sandbox");
            }
            if !session.is_empty() {
                cmd.arg(session);
            }
            cmd.arg("-")
                .stdin(std::fs::File::open(prompt).map_err(|e| e.to_string())?);
        }
        Provider::Antigravity => {
            cmd.args([
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
            ]);
            cmd.args(options.args(provider));
            if !session.is_empty() {
                cmd.arg("--conversation").arg(session);
            }
            if yolo {
                cmd.arg("--dangerously-skip-permissions");
            }
            cmd.stdin(std::fs::File::open(prompt).map_err(|e| e.to_string())?);
        }
    }
    cmd.current_dir(workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // The Windows sandbox account can differ from the desktop owner. Trust
    // just this selected repository in the child environment, never '*', ACLs
    // or the user's global Git config. Host git_status also applies it as -c.
    if let Some(root) = crate::workspace_tools::repository_root(workspace) {
        if let Some(count) = match std::env::var("GIT_CONFIG_COUNT") {
            Ok(count) => count.parse::<u32>().ok(),
            Err(std::env::VarError::NotPresent) => Some(0),
            Err(_) => None,
        }
        .filter(|n| *n < 100)
        {
            cmd.env("GIT_CONFIG_COUNT", (count + 1).to_string())
                .env(format!("GIT_CONFIG_KEY_{count}"), "safe.directory")
                .env(format!("GIT_CONFIG_VALUE_{count}"), root);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    Ok(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_fresh_and_resumed_turns_receive_only_the_selected_write_root() {
        let prompt = std::env::temp_dir().join(format!("velum-argv-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&prompt, "probe").unwrap();
        let workspace = Path::new(r"C:\projects\selected & quoted's project");
        for resume in ["", "62c2d305-9dd5-4c94-b4c0-667eb612f401"] {
            for yolo in [false, true] {
                let command = exec_command(
                    Provider::Codex,
                    Path::new("codex.exe"),
                    resume,
                    workspace,
                    &prompt,
                    yolo,
                    &Default::default(),
                )
                .unwrap();
                let args: Vec<_> = command
                    .get_args()
                    .map(|a| a.to_string_lossy().into_owned())
                    .collect();
                assert_eq!(command.get_current_dir(), Some(workspace));
                assert_eq!(
                    args[args.iter().position(|a| a == "-C").unwrap() + 1],
                    workspace.display().to_string()
                );
                let roots = args
                    .iter()
                    .find_map(|a| a.strip_prefix("sandbox_workspace_write.writable_roots="))
                    .unwrap();
                assert_eq!(
                    serde_json::from_str::<Vec<String>>(roots).unwrap(),
                    [workspace.display().to_string()]
                );
                assert!(args.contains(&"sandbox_mode=\"workspace-write\"".into()));
                assert_eq!(
                    args.contains(&"--dangerously-bypass-approvals-and-sandbox".into()),
                    yolo
                );
                assert_eq!(args.contains(&"resume".into()), !resume.is_empty());
            }
        }
        std::fs::remove_file(prompt).unwrap();
    }
}
