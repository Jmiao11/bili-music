use super::{
    library_file_path, normalize_bvid, now_millis, read_json_or_default, write_json_atomic,
    Versioned, LOUDNESS_FILE, VERSION,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_LOUDNESS_ITEMS: usize = 2000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoudnessItem {
    key: String,
    lufs: f64,
    measured_at: u128,
}

#[derive(Debug, Deserialize, Serialize)]
struct LoudnessFile {
    version: u32,
    items: Vec<LoudnessItem>,
}

impl Default for LoudnessFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
        }
    }
}

impl Versioned for LoudnessFile {
    fn version(&self) -> u32 {
        self.version
    }
}

fn validate_loudness_key(key: &str) -> Result<(), String> {
    let (bvid, cid) = key.split_once(':').ok_or("响度键必须是 bvid:cid。")?;
    let normalized = normalize_bvid(bvid)?;
    let cid = cid
        .parse::<u64>()
        .ok()
        .filter(|cid| *cid > 0)
        .ok_or("响度键缺少有效 cid。")?;
    if key != format!("{normalized}:{cid}") {
        return Err("响度键必须是规范的 bvid:cid。".to_owned());
    }
    Ok(())
}

fn get_track_loudness_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    key: &str,
) -> Result<Option<f64>, String> {
    validate_loudness_key(key)?;
    let file: LoudnessFile = read_json_or_default(guard, path)?;
    Ok(file
        .items
        .iter()
        .find(|item| item.key == key)
        .map(|item| item.lufs))
}

#[tauri::command]
pub fn get_track_loudness(key: String) -> Result<Option<f64>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    get_track_loudness_at(guard, &library_file_path(guard, LOUDNESS_FILE)?, &key)
}

fn save_track_loudness_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    key: &str,
    lufs: f64,
    measured_at: u128,
) -> Result<(), String> {
    validate_loudness_key(key)?;
    if !lufs.is_finite() {
        return Err("响度必须是有限数值。".to_owned());
    }
    let mut file: LoudnessFile = read_json_or_default(guard, path)?;
    file.items.retain(|item| item.key != key);
    file.items.push(LoudnessItem {
        key: key.to_owned(),
        lufs,
        measured_at,
    });
    file.items
        .sort_by_key(|item| std::cmp::Reverse(item.measured_at));
    file.items.truncate(MAX_LOUDNESS_ITEMS);
    write_json_atomic(guard, path, &file)
}

pub(crate) fn save_track_loudness(key: &str, lufs: f64) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    save_track_loudness_at(
        guard,
        &library_file_path(guard, LOUDNESS_FILE)?,
        key,
        lufs,
        now_millis(),
    )
}

#[tauri::command]
pub fn clear_loudness_data() -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    write_json_atomic(
        guard,
        &library_file_path(guard, LOUDNESS_FILE)?,
        &LoudnessFile::default(),
    )
}

#[cfg(test)]
mod tests {
    use super::super::test_support::test_path;
    use super::*;
    use std::fs;

    #[test]
    fn loudness_round_trip_missing_key_and_update() {
        let path = test_path();
        let key = "BV1GF4X6MEb1:1";
        assert_eq!(
            super::get_track_loudness_at(&crate::storage::lock_storage().unwrap(), &path, key)
                .unwrap(),
            None
        );
        super::save_track_loudness_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            key,
            -10.55,
            100,
        )
        .unwrap();
        assert_eq!(
            super::get_track_loudness_at(&crate::storage::lock_storage().unwrap(), &path, key)
                .unwrap(),
            Some(-10.55)
        );
        assert_eq!(
            super::get_track_loudness_at(
                &crate::storage::lock_storage().unwrap(),
                &path,
                "BV1GF4X6MEb1:2"
            )
            .unwrap(),
            None
        );
        super::save_track_loudness_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            key,
            -13.75,
            200,
        )
        .unwrap();
        let file: super::LoudnessFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(file.items.len(), 1);
        assert_eq!(file.items[0].measured_at, 200);
        assert_eq!(file.items[0].lufs, -13.75);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn loudness_evicts_oldest_measurement_not_first_entry() {
        let path = test_path();
        let file = super::LoudnessFile {
            version: VERSION,
            items: (1..=2000)
                .map(|cid| super::LoudnessItem {
                    key: format!("BV1GF4X6MEb1:{cid}"),
                    lufs: -10.0,
                    measured_at: if cid == 999 { 0 } else { cid },
                })
                .collect(),
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        super::save_track_loudness_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1:2001",
            -12.0,
            3000,
        )
        .unwrap();
        let saved: super::LoudnessFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(saved.items.len(), 2000);
        assert!(!saved
            .items
            .iter()
            .any(|item| item.key == "BV1GF4X6MEb1:999"));
        assert!(saved.items.iter().any(|item| item.key == "BV1GF4X6MEb1:1"));
        assert_eq!(saved.items[0].key, "BV1GF4X6MEb1:2001");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn loudness_rejects_unsupported_version_without_overwriting() {
        let path = test_path();
        let bytes = r#"{"version":999,"items":[]}"#;
        fs::write(&path, bytes).unwrap();
        assert!(super::get_track_loudness_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1:1"
        )
        .is_err());
        assert!(super::save_track_loudness_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1:1",
            -10.0,
            1
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn loudness_rejects_missing_cid_and_non_finite_measurements() {
        let path = test_path();
        for key in [
            "BV1GF4X6MEb1",
            "BV1GF4X6MEb1:0",
            "BV1GF4X6MEb1:",
            "BV1GF4X6MEb1:01",
        ] {
            assert!(super::save_track_loudness_at(
                &crate::storage::lock_storage().unwrap(),
                &path,
                key,
                -10.0,
                1
            )
            .is_err());
        }
        assert!(super::save_track_loudness_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "BV1GF4X6MEb1:1",
            f64::NAN,
            1
        )
        .is_err());
        assert!(!path.exists());
    }
}
