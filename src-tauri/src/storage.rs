//! Small atomic JSON snapshots. The temporary file lives beside its destination.
use std::{fs, io::Write, path::Path};
pub fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
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
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
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
