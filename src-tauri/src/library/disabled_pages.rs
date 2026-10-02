use super::{
    library_file_path, normalize_bvid, read_json_or_default, write_json_atomic, Versioned,
    DISABLED_PAGES_FILE, VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Deserialize, Serialize)]
struct DisabledPagesFile {
    version: u32,
    videos: BTreeMap<String, BTreeSet<u64>>,
}

impl Default for DisabledPagesFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            videos: BTreeMap::new(),
        }
    }
}

impl Versioned for DisabledPagesFile {
    fn version(&self) -> u32 {
        self.version
    }
}

fn set_page_disabled_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    bvid: &str,
    cid: u64,
    disabled: bool,
) -> Result<(), String> {
    let bvid = normalize_bvid(bvid)?;
    if cid == 0 {
        return Err("分P CID 必须为正整数。".to_owned());
    }
    let mut file: DisabledPagesFile = read_json_or_default(guard, path)?;
    let key = file
        .videos
        .keys()
        .find(|key| key.eq_ignore_ascii_case(&bvid))
        .cloned()
        .unwrap_or(bvid);
    let changed = if disabled {
        file.videos.entry(key).or_default().insert(cid)
    } else if let Some(cids) = file.videos.get_mut(&key) {
        let changed = cids.remove(&cid);
        if cids.is_empty() {
            file.videos.remove(&key);
        }
        changed
    } else {
        false
    };
    if changed {
        write_json_atomic(guard, path, &file)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_page_disabled(bvid: String, cid: u64, disabled: bool) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    set_page_disabled_at(
        guard,
        &library_file_path(guard, DISABLED_PAGES_FILE)?,
        &bvid,
        cid,
        disabled,
    )
}

fn clear_disabled_pages_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    bvid: &str,
) -> Result<(), String> {
    let bvid = normalize_bvid(bvid)?;
    let mut file: DisabledPagesFile = read_json_or_default(guard, path)?;
    let before = file.videos.len();
    file.videos
        .retain(|key, _| !key.eq_ignore_ascii_case(&bvid));
    if file.videos.len() != before {
        write_json_atomic(guard, path, &file)?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_disabled_pages(bvid: String) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    clear_disabled_pages_at(
        guard,
        &library_file_path(guard, DISABLED_PAGES_FILE)?,
        &bvid,
    )
}

#[tauri::command]
pub fn list_disabled_pages() -> Result<BTreeMap<String, BTreeSet<u64>>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    Ok(read_json_or_default::<DisabledPagesFile>(
        guard,
        &library_file_path(guard, DISABLED_PAGES_FILE)?,
    )?
    .videos)
}

pub(super) fn validate_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<DisabledPagesFile>(file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::test_path;
    use super::*;
    use std::fs;

    #[test]
    fn disabled_pages_set_is_idempotent_and_single_restore_removes_empty_video() {
        let path = test_path();
        super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            " BV1GF4X6MEb1 ",
            123,
            true,
        )
        .unwrap();
        let first_write = fs::read(&path).unwrap();
        super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1",
            123,
            true,
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), first_write);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&first_write).unwrap(),
            serde_json::json!({"version": 1, "videos": {"BV1GF4X6MEb1": [123]}})
        );
        super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1",
            123,
            false,
        )
        .unwrap();
        let file: super::DisabledPagesFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert!(file.videos.is_empty());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn disabled_pages_clear_only_target_video() {
        let path = test_path();
        super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1",
            123,
            true,
        )
        .unwrap();
        super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1",
            456,
            true,
        )
        .unwrap();
        super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1rW4y1Q7o7",
            789,
            true,
        )
        .unwrap();
        super::clear_disabled_pages_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1",
        )
        .unwrap();
        let file: super::DisabledPagesFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert!(!file.videos.contains_key("BV1GF4X6MEb1"));
        assert_eq!(
            file.videos["BV1rW4y1Q7o7"]
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            vec![789]
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn disabled_pages_reject_invalid_bvid_and_cid_without_writing() {
        let path = test_path();
        assert!(super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "av123",
            1,
            true
        )
        .is_err());
        assert!(super::set_page_disabled_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1",
            0,
            true
        )
        .is_err());
        assert!(super::clear_disabled_pages_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "av123"
        )
        .is_err());
        assert!(!path.exists());
    }
}
