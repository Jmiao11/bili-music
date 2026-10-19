use super::entries::{
    backup_before_v2, decode_entries, entries_json, entries_version, LibraryEntry,
};
use super::{
    library_file_path, normalize_bvid, read_json_or_default, snapshot_from_input,
    TrackSnapshotInput, Versioned, FAVORITES_FILE, VERSION,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteToggleResult {
    pub favorited: bool,
    pub items: Vec<LibraryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(try_from = "FavoritesWire")]
pub(super) struct FavoritesFile {
    pub(super) version: u32,
    pub(super) items: Vec<LibraryEntry>,
}

#[derive(Deserialize)]
struct FavoritesWire {
    version: u32,
    items: Vec<serde_json::Value>,
}
impl TryFrom<FavoritesWire> for FavoritesFile {
    type Error = String;
    fn try_from(wire: FavoritesWire) -> Result<Self, String> {
        Ok(Self {
            version: wire.version,
            items: decode_entries(wire.version, wire.items)?,
        })
    }
}
impl Serialize for FavoritesFile {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let version = entries_version(&self.items);
        let items = entries_json(&self.items, version).map_err(serde::ser::Error::custom)?;
        serde_json::json!({"version":version,"items":items}).serialize(serializer)
    }
}
pub(super) fn write_favorites(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    file: &FavoritesFile,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(file).map_err(|_| "无法编码收藏资料库。")?;
    validate_import_json("favorites.json", &bytes)?;
    if entries_version(&file.items) == 2 {
        backup_before_v2(guard, path)?;
    }
    super::write_json_atomic(guard, path, file)
}

impl Default for FavoritesFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn list_favorites() -> Result<Vec<LibraryEntry>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    Ok(read_favorites(guard)?.items)
}

#[tauri::command]
pub fn is_favorite(bvid: String) -> Result<bool, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    let bvid = normalize_bvid(&bvid)?;
    Ok(read_favorites(guard)?
        .items
        .iter()
        .any(|track| track.is_video(&bvid)))
}

#[tauri::command]
pub fn toggle_favorite(track: TrackSnapshotInput) -> Result<FavoriteToggleResult, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    toggle_favorite_at(guard, &favorites_path(guard)?, track)
}

fn toggle_favorite_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    track: TrackSnapshotInput,
) -> Result<FavoriteToggleResult, String> {
    let mut file: FavoritesFile = read_json_or_default(guard, path)?;
    let bvid = normalize_bvid(&track.bvid)?;
    if let Some(index) = file.items.iter().position(|item| item.is_video(&bvid)) {
        file.items.remove(index);
        write_favorites(guard, path, &file)?;
        return Ok(FavoriteToggleResult {
            favorited: false,
            items: file.items,
        });
    }

    file.items.insert(0, snapshot_from_input(track)?.into());
    write_favorites(guard, path, &file)?;
    Ok(FavoriteToggleResult {
        favorited: true,
        items: file.items,
    })
}

#[tauri::command]
pub fn reorder_favorite(from_index: usize, to_index: usize) -> Result<Vec<LibraryEntry>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    reorder_favorite_at(guard, &favorites_path(guard)?, from_index, to_index)
}

fn reorder_favorite_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<LibraryEntry>, String> {
    let mut file: FavoritesFile = read_json_or_default(guard, path)?;
    if from_index >= file.items.len() || to_index >= file.items.len() {
        return Err("收藏歌曲下标越界。".to_owned());
    }
    if from_index == to_index {
        return Ok(file.items);
    }
    let item = file.items.remove(from_index);
    file.items.insert(to_index, item);
    write_favorites(guard, path, &file)?;
    Ok(file.items)
}

pub(super) fn read_favorites(
    guard: &crate::storage::StorageGuard,
) -> Result<FavoritesFile, String> {
    read_json_or_default(guard, &favorites_path(guard)?)
}

impl Versioned for FavoritesFile {
    fn version(&self) -> u32 {
        self.version
    }
    fn ensure_supported_version(&self, path: &Path) -> Result<(), String> {
        if self.version == 1 || self.version == 2 {
            Ok(())
        } else {
            Err(format!(
                "{} 的数据版本 {} 暂不支持。",
                path.display(),
                self.version
            ))
        }
    }
}

pub(super) fn favorites_path(guard: &crate::storage::StorageGuard) -> Result<PathBuf, String> {
    library_file_path(guard, FAVORITES_FILE)
}

pub(super) fn validate_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<FavoritesFile>(file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::super::read_json_or_default;
    use super::super::test_support::track;
    use super::{
        reorder_favorite_at, toggle_favorite_at, FavoritesFile, TrackSnapshotInput, VERSION,
    };
    use crate::library::TrackSnapshot;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn favorite_fixture() -> (PathBuf, FavoritesFile) {
        let file = FavoritesFile {
            version: VERSION,
            items: [
                "BV1rW4y1Q7o7",
                "BV1gB7m6eEHm",
                "BV1FEQuBXEn1",
                "BV1FPjy6TEiE",
            ]
            .into_iter()
            .map(|bvid| TrackSnapshot {
                bvid: bvid.to_owned(),
                ..track(bvid)
            })
            .map(super::LibraryEntry::from)
            .collect(),
        };
        let path =
            std::env::temp_dir().join(format!("bili-music-favorites-{}.json", Uuid::new_v4()));
        // A rewrite through the pretty-printing writer would change these compact bytes.
        fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
        (path, file)
    }

    fn favorite_input(bvid: &str) -> TrackSnapshotInput {
        TrackSnapshotInput {
            bvid: bvid.to_owned(),
            title: "new favorite".to_owned(),
            uploader: "UP".to_owned(),
            thumbnail_url: "https://example.com/cover.jpg".to_owned(),
            duration_seconds: 120,
        }
    }

    #[test]
    fn favorite_order_moves_forward() {
        let (path, original) = favorite_fixture();
        let result =
            reorder_favorite_at(&crate::storage::lock_storage().unwrap(), &path, 0, 3).unwrap();
        let expected = [1, 2, 3, 0].map(|index| &original.items[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: FavoritesFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(persisted.version, 1);
        assert_eq!(
            serde_json::to_value(persisted.items).unwrap(),
            serde_json::to_value(result).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn favorite_order_moves_backward() {
        let (path, original) = favorite_fixture();
        let result =
            reorder_favorite_at(&crate::storage::lock_storage().unwrap(), &path, 3, 1).unwrap();
        let expected = [0, 3, 1, 2].map(|index| &original.items[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: FavoritesFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(
            serde_json::to_value(persisted.items).unwrap(),
            serde_json::to_value(result).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn favorite_order_same_index_does_not_write() {
        let (path, original) = favorite_fixture();
        let before = fs::read(&path).unwrap();
        let result =
            reorder_favorite_at(&crate::storage::lock_storage().unwrap(), &path, 2, 2).unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(original.items).unwrap()
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn favorite_order_out_of_bounds_leaves_data_unchanged() {
        let (path, original) = favorite_fixture();
        let before = fs::read(&path).unwrap();
        let len = original.items.len();
        for (from, to) in [
            (len, 0),
            (0, len),
            (len, len),
            (usize::MAX, 0),
            (0, usize::MAX),
        ] {
            assert!(
                reorder_favorite_at(&crate::storage::lock_storage().unwrap(), &path, from, to)
                    .is_err()
            );
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        let empty = serde_json::to_vec(&FavoritesFile::default()).unwrap();
        fs::write(&path, &empty).unwrap();
        assert!(
            reorder_favorite_at(&crate::storage::lock_storage().unwrap(), &path, 0, 0).is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), empty);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn favorite_order_preserves_count_and_bvids() {
        let (path, original) = favorite_fixture();
        let mut expected: Vec<_> = original
            .items
            .iter()
            .map(|item| &item.video().unwrap().bvid)
            .collect();
        expected.sort();
        for from in 0..expected.len() {
            for to in 0..expected.len() {
                let result =
                    reorder_favorite_at(&crate::storage::lock_storage().unwrap(), &path, from, to)
                        .unwrap();
                assert_eq!(result.len(), expected.len());
                let mut actual: Vec<_> = result
                    .iter()
                    .map(|item| &item.video().unwrap().bvid)
                    .collect();
                actual.sort();
                assert_eq!(actual, expected);
            }
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn toggle_favorite_inserts_new_item_at_front() {
        let (path, original) = favorite_fixture();
        let result = toggle_favorite_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            favorite_input("BV1i6K46HEcf"),
        )
        .unwrap();
        assert!(result.favorited);
        assert_eq!(result.items.len(), original.items.len() + 1);
        assert_eq!(result.items[0].video().unwrap().bvid, "BV1i6K46HEcf");
        assert_eq!(result.items[0].video().unwrap().title, "new favorite");
        assert!(!result.items[0].video().unwrap().added_at.is_empty());
        assert_eq!(
            serde_json::to_value(&result.items[1..]).unwrap(),
            serde_json::to_value(original.items).unwrap()
        );
        let persisted: FavoritesFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(persisted.version, 1);
        assert_eq!(
            serde_json::to_value(persisted.items).unwrap(),
            serde_json::to_value(result.items).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn toggle_favorite_removes_existing_bvid_case_insensitively() {
        for bvid in ["BV1rW4y1Q7o7", "BV1RW4Y1Q7O7"] {
            let (path, original) = favorite_fixture();
            let result = toggle_favorite_at(
                &crate::storage::lock_storage().unwrap(),
                &path,
                favorite_input(bvid),
            )
            .unwrap();
            assert!(!result.favorited);
            assert_eq!(result.items.len(), original.items.len() - 1);
            assert_eq!(
                serde_json::to_value(&result.items).unwrap(),
                serde_json::to_value(&original.items[1..]).unwrap()
            );
            let persisted: FavoritesFile =
                read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
            assert_eq!(
                serde_json::to_value(persisted.items).unwrap(),
                serde_json::to_value(result.items).unwrap()
            );
            fs::remove_file(path).unwrap();
        }
    }
}
