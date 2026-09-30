//! Small atomic JSON snapshots. The temporary file lives beside its destination.
use std::{fs, io::Write, path::Path};
pub fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    write_bytes(path, &bytes)
}
pub fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // Check encoded bytes, including JSON escapes, before replacing a good
    // checkpoint. Readers reject snapshots larger than this limit.
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(
            "Saved data exceeds the 4 MB recovery limit. Shorten or close a large draft.".into(),
        );
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        replace_snapshot(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn replace_snapshot(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    for attempt in 0..6 {
        match fs::rename(temporary, destination) {
            Ok(()) => return Ok(()),
            Err(error) => {
                // Windows readers/sync clients can briefly omit delete sharing.
                // Retry the atomic rename only; never remove the saved file or
                // change permissions. Permanent denials still return an error.
                if attempt == 5 || !matches!(error.raw_os_error(), Some(5 | 32 | 33)) {
                    return Err(error);
                }
                std::thread::sleep(std::time::Duration::from_millis(10 << attempt));
            }
        }
    }
    fs::rename(temporary, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn a_brief_windows_reader_lock_does_not_lose_an_atomic_update() {
        use std::os::windows::fs::OpenOptionsExt;
        let root =
            std::env::temp_dir().join(format!("velum-locked-snapshot-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("appearance.json");
        write_json(&path, &"original").unwrap();
        // Some Windows readers and sync clients omit FILE_SHARE_DELETE. They
        // allow reads but briefly prevent replacing the destination file.
        let reader = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(75));
            drop(reader);
        });
        let result = write_json(&path, &"latest");
        release.join().unwrap();
        assert!(
            result.is_ok(),
            "Transient reader lock lost the update: {result:?}"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "\"latest\"");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let persistent = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        assert!(write_json(&path, &"blocked").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "\"latest\"");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        drop(persistent);
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn escaped_text_cannot_replace_a_readable_checkpoint_with_an_oversized_one() {
        let root =
            std::env::temp_dir().join(format!("velum-storage-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("desktop.json");
        write_json(&path, &"original").unwrap();
        write_json(&path, &"latest").unwrap();
        assert!(write_json(&path, &"\0".repeat(750_000)).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "\"latest\"");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
