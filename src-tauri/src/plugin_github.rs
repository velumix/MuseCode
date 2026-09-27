//! GitHub-only downloads. No git checkout, archive extraction or build scripts.
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Origin {
    pub repository: String,
    pub commit: String,
}

pub fn repository(input: &str) -> Result<String, String> {
    let input = input.trim().trim_end_matches('/');
    let input = input.strip_prefix("https://github.com/").unwrap_or(input);
    let input = input.strip_suffix(".git").unwrap_or(input);
    let parts: Vec<_> = input.split('/').collect();
    if parts.len() != 2
        || parts[0].is_empty()
        || parts[0].len() > 39
        || !parts[0]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || parts[1].is_empty()
        || parts[1].len() > 100
        || parts[1] == "."
        || parts[1] == ".."
        || !parts[1]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err(
            "Enter a public GitHub repository: owner/repo or https://github.com/owner/repo.".into(),
        );
    }
    Ok(input.to_lowercase())
}
pub fn valid_origin(origin: &Origin) -> bool {
    repository(&origin.repository).is_ok_and(|r| r == origin.repository)
        && origin.commit.len() == 40
        && origin.commit.bytes().all(|b| b.is_ascii_hexdigit())
}
fn download(client: &Client, path: &str, accept: &str, limit: usize) -> Result<String, String> {
    download_url(
        client,
        &format!("https://api.github.com/repos/{path}"),
        accept,
        limit,
    )
}
fn download_url(client: &Client, url: &str, accept: &str, limit: usize) -> Result<String, String> {
    let response = client
        .get(url)
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(|_| "Cannot reach GitHub. Check your connection and try again.".to_string())?;
    match response.status().as_u16() {
        200 => {},
        403 | 429 => return Err("GitHub is limiting requests or denying access. Try again later. Installed plugins still work offline.".into()),
        404 => return Err("Repository or plugin files not found. Use a public repository with velum-plugin.json and index.js at its root.".into()),
        301 | 302 | 307 | 308 => return Err("This repository moved. Use its current GitHub URL.".into()),
        code => return Err(format!("GitHub returned HTTP {code}. Try again later.")),
    }
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err("GitHub file exceeds the plugin size limit.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not finish downloading the plugin.".to_string())?;
    if bytes.len() > limit {
        return Err("GitHub file exceeds the plugin size limit.".into());
    }
    String::from_utf8(bytes).map_err(|_| "Plugin files must be UTF-8 text.".into())
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("VelumCode-Plugins/1")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
pub fn directory() -> Result<String, String> {
    download_url(
        &client()?,
        "https://raw.githubusercontent.com/velumix/velum-code-plugins/main/catalog.json",
        "application/json",
        1024 * 1024,
    )
}
pub fn package(input: &str, pinned: Option<&str>) -> Result<(Origin, String, String), String> {
    let repository = repository(input)?;
    if pinned.is_some_and(|sha| sha.len() != 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit())) {
        return Err("Invalid listed plugin commit. Refresh the directory.".into());
    }
    let client = client()?;
    // HEAD resolves the default branch to one immutable commit before either file is read.
    let commit = if let Some(commit) = pinned {
        commit.to_lowercase()
    } else {
        download(
            &client,
            &format!("{repository}/commits/HEAD"),
            "application/vnd.github.sha",
            256,
        )?
        .trim()
        .to_string()
    };
    let origin = Origin { repository, commit };
    if !valid_origin(&origin) {
        return Err("GitHub did not return a valid commit.".into());
    }
    let manifest = download(
        &client,
        &format!(
            "{}/contents/velum-plugin.json?ref={}",
            origin.repository, origin.commit
        ),
        "application/vnd.github.raw+json",
        32 * 1024,
    )?;
    let source = download(
        &client,
        &format!(
            "{}/contents/index.js?ref={}",
            origin.repository, origin.commit
        ),
        "application/vnd.github.raw+json",
        512 * 1024,
    )?;
    Ok((origin, manifest, source))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires public GitHub access; run explicitly for release verification"]
    fn live_github_plugin_download() {
        let (origin, manifest, source) =
            package("velumix/velum-plugin-project-tools", None).unwrap();
        assert!(valid_origin(&origin));
        assert_eq!(origin.repository, "velumix/velum-plugin-project-tools");
        let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(manifest["id"], "velum.project-tools");
        assert!(source.contains("self.VelumPlugin = plugin"));
        println!("Downloaded both plugin files at commit {}", origin.commit);
        let list: serde_json::Value = serde_json::from_str(&directory().unwrap()).unwrap();
        let entry = list["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["repository"] == "velumix/velum-plugin-project-tools")
            .unwrap();
        let (listed, _, _) = package(
            entry["repository"].as_str().unwrap(),
            entry["commit"].as_str(),
        )
        .unwrap();
        assert_eq!(listed.commit, entry["commit"].as_str().unwrap());
        println!("Downloaded directory and its pinned plugin version.");
    }
    #[test]
    fn github_urls_only() {
        assert_eq!(
            repository(" https://github.com/Velumix/Example.git/ ").unwrap(),
            "velumix/example"
        );
        for input in [
            "C:\\plugin",
            "https://evil.test/a/b",
            "https://github.com.evil/a/b",
            "https://github.com/u/r/tree/main",
            "u/..",
            "u/r?x=y",
            "https://user@github.com/a/b",
            "a/%2e%2e",
            "a/b#secret",
        ] {
            assert!(repository(input).is_err(), "{input}");
        }
        assert!(valid_origin(&Origin {
            repository: "a/b".into(),
            commit: "a".repeat(40)
        }));
        assert!(!valid_origin(&Origin {
            repository: "a/b".into(),
            commit: "main".into()
        }));
    }
}
