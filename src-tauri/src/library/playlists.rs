use super::{
    library_file_path, normalize_bvid, normalize_playlist_name, now_millis, now_string,
    read_json_or_default, snapshot_from_input, write_json_atomic, TrackSnapshot,
    TrackSnapshotInput, Versioned, PLAYLISTS_FILE, VERSION,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub items: Vec<TrackSnapshot>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct PlaylistsFile {
    pub(super) version: u32,
    pub(super) playlists: Vec<Playlist>,
}

impl Default for PlaylistsFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            playlists: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn reorder_playlist(from_index: usize, to_index: usize) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    reorder_playlist_at(guard, &playlists_path(guard)?, from_index, to_index)
}

fn reorder_playlist_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<Playlist>, String> {
    let mut file: PlaylistsFile = read_json_or_default(guard, path)?;
    if from_index >= file.playlists.len() || to_index >= file.playlists.len() {
        return Err("歌单下标越界。".to_owned());
    }
    if from_index == to_index {
        return Ok(file.playlists);
    }
    let playlist = file.playlists.remove(from_index);
    file.playlists.insert(to_index, playlist);
    write_json_atomic(guard, path, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn list_playlists() -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    Ok(read_playlists(guard)?.playlists)
}

#[tauri::command]
pub fn create_playlist(name: String) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    let mut file = read_playlists(guard)?;
    let name = normalize_playlist_name(&name)?;
    let now = now_string();
    file.playlists.push(Playlist {
        id: format!("{}-{}", now_millis(), Uuid::new_v4().simple()),
        name,
        created_at: now,
        items: Vec::new(),
    });
    write_json_atomic(guard, &playlists_path(guard)?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn rename_playlist(id: String, name: String) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    let mut file = read_playlists(guard)?;
    let name = normalize_playlist_name(&name)?;
    let playlist = find_playlist_mut(&mut file, &id)?;
    playlist.name = name;
    write_json_atomic(guard, &playlists_path(guard)?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn delete_playlist(id: String) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    let mut file = read_playlists(guard)?;
    let original_len = file.playlists.len();
    file.playlists.retain(|playlist| playlist.id != id);
    if file.playlists.len() == original_len {
        return Err("歌单不存在。".to_owned());
    }
    write_json_atomic(guard, &playlists_path(guard)?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn add_to_playlist(id: String, track: TrackSnapshotInput) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    add_to_playlist_at(guard, &playlists_path(guard)?, id, track)
}

fn add_to_playlist_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    id: String,
    track: TrackSnapshotInput,
) -> Result<Vec<Playlist>, String> {
    let mut file = read_json_or_default(guard, path)?;
    let snapshot = snapshot_from_input(track)?;
    let playlist = find_playlist_mut(&mut file, &id)?;
    if playlist
        .items
        .iter()
        .any(|item| item.bvid.eq_ignore_ascii_case(&snapshot.bvid))
    {
        return Err(format!("歌曲已在歌单“{}”中。", playlist.name));
    }
    playlist.items.push(snapshot);
    write_json_atomic(guard, path, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn remove_from_playlist(id: String, bvid: String) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    let mut file = read_playlists(guard)?;
    let bvid = normalize_bvid(&bvid)?;
    let playlist = find_playlist_mut(&mut file, &id)?;
    let original_len = playlist.items.len();
    playlist
        .items
        .retain(|item| !item.bvid.eq_ignore_ascii_case(&bvid));
    if playlist.items.len() == original_len {
        return Err("歌曲不在这个歌单中。".to_owned());
    }
    write_json_atomic(guard, &playlists_path(guard)?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn reorder_playlist_item(
    id: String,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<Playlist>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    reorder_playlist_item_at(guard, &playlists_path(guard)?, &id, from_index, to_index)
}

fn reorder_playlist_item_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    id: &str,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<Playlist>, String> {
    let mut file: PlaylistsFile = read_json_or_default(guard, path)?;
    let playlist = find_playlist_mut(&mut file, id)?;
    if from_index >= playlist.items.len() || to_index >= playlist.items.len() {
        return Err("歌单歌曲下标越界。".to_owned());
    }
    if from_index == to_index {
        return Ok(file.playlists);
    }
    let item = playlist.items.remove(from_index);
    playlist.items.insert(to_index, item);
    write_json_atomic(guard, path, &file)?;
    Ok(file.playlists)
}

fn read_playlists(guard: &crate::storage::StorageGuard) -> Result<PlaylistsFile, String> {
    read_json_or_default(guard, &playlists_path(guard)?)
}

impl Versioned for PlaylistsFile {
    fn version(&self) -> u32 {
        self.version
    }
}

// Import uses the same reader, normalization and atomic writer as add_to_playlist.
#[tauri::command]
pub fn create_imported_playlist(
    name: String,
    tracks: Vec<TrackSnapshotInput>,
) -> Result<Playlist, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    create_imported_playlist_at(guard, &playlists_path(guard)?, name, tracks)
}

fn create_imported_playlist_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    name: String,
    tracks: Vec<TrackSnapshotInput>,
) -> Result<Playlist, String> {
    let mut file: PlaylistsFile = read_json_or_default(guard, path)?;
    let name = normalize_playlist_name(&name)?;
    if file
        .playlists
        .iter()
        .any(|item| item.name.trim().to_lowercase() == name.to_lowercase())
    {
        return Err("已存在同名歌单，请换个名字。".to_owned());
    }
    if tracks.is_empty() || tracks.len() > 200 {
        return Err("导入歌单须包含 1 至 200 条视频。".to_owned());
    }
    let mut items: Vec<TrackSnapshot> = Vec::new();
    for track in tracks {
        let snapshot = snapshot_from_input(track)?;
        if !items
            .iter()
            .any(|item| item.bvid.eq_ignore_ascii_case(&snapshot.bvid))
        {
            items.push(snapshot);
        }
    }
    let playlist = Playlist {
        id: format!("{}-{}", now_millis(), Uuid::new_v4().simple()),
        name,
        created_at: now_string(),
        items,
    };
    file.playlists.push(playlist.clone());
    write_json_atomic(guard, path, &file)?;
    Ok(playlist)
}

fn find_playlist_mut<'a>(
    file: &'a mut PlaylistsFile,
    id: &str,
) -> Result<&'a mut Playlist, String> {
    file.playlists
        .iter_mut()
        .find(|playlist| playlist.id == id)
        .ok_or_else(|| "歌单不存在。".to_owned())
}

pub(super) fn playlists_path(guard: &crate::storage::StorageGuard) -> Result<PathBuf, String> {
    library_file_path(guard, PLAYLISTS_FILE)
}

pub(super) fn validate_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<PlaylistsFile>(file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::track;
    use super::*;
    use std::fs;

    fn reorder_fixture() -> (PathBuf, PlaylistsFile) {
        let file = PlaylistsFile {
            version: VERSION,
            playlists: vec![
                Playlist {
                    id: "test".to_owned(),
                    name: "排序测试".to_owned(),
                    created_at: "1".to_owned(),
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
                    .collect(),
                },
                Playlist {
                    id: "empty".to_owned(),
                    name: "空歌单".to_owned(),
                    created_at: "2".to_owned(),
                    items: Vec::new(),
                },
            ],
        };
        let path =
            std::env::temp_dir().join(format!("bili-music-playlist-{}.json", Uuid::new_v4()));
        // Compact JSON makes an unnecessary write via the pretty-printing writer detectable.
        fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
        (path, file)
    }

    #[test]
    fn reorder_moves_item_forward() {
        let (path, original) = reorder_fixture();
        let result = reorder_playlist_item_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "test",
            0,
            3,
        )
        .unwrap();
        let expected = [1, 2, 3, 0].map(|index| original.playlists[0].items[index].clone());
        assert_eq!(
            serde_json::to_value(&result[0].items).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&result[1]).unwrap(),
            serde_json::to_value(&original.playlists[1]).unwrap()
        );
        let persisted: PlaylistsFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(persisted.version, 1);
        assert_eq!(
            serde_json::to_value(persisted.playlists).unwrap(),
            serde_json::to_value(result).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reorder_moves_item_backward() {
        let (path, original) = reorder_fixture();
        let result = reorder_playlist_item_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "test",
            3,
            1,
        )
        .unwrap();
        let expected = [0, 3, 1, 2].map(|index| original.playlists[0].items[index].clone());
        assert_eq!(
            serde_json::to_value(&result[0].items).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: PlaylistsFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(
            serde_json::to_value(persisted.playlists).unwrap(),
            serde_json::to_value(result).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reorder_same_index_does_not_write() {
        let (path, original) = reorder_fixture();
        let before = fs::read(&path).unwrap();
        let result = reorder_playlist_item_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "test",
            2,
            2,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(original.playlists).unwrap()
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reorder_out_of_bounds_leaves_data_unchanged() {
        let (path, original) = reorder_fixture();
        let before = fs::read(&path).unwrap();
        let len = original.playlists[0].items.len();
        for (from, to) in [
            (len, 0),
            (0, len),
            (len, len),
            (usize::MAX, 0),
            (0, usize::MAX),
        ] {
            assert!(reorder_playlist_item_at(
                &crate::storage::lock_storage().unwrap(),
                &path,
                "test",
                from,
                to
            )
            .is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        assert!(reorder_playlist_item_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "empty",
            0,
            0
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reorder_missing_playlist_returns_error() {
        let (path, _) = reorder_fixture();
        let before = fs::read(&path).unwrap();
        assert!(reorder_playlist_item_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "missing",
            0,
            1
        )
        .is_err());
        assert!(reorder_playlist_item_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "missing",
            0,
            0
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reorder_preserves_length_and_bvids() {
        let (path, original) = reorder_fixture();
        let mut expected: Vec<_> = original.playlists[0]
            .items
            .iter()
            .map(|item| &item.bvid)
            .collect();
        expected.sort();
        for from in 0..expected.len() {
            for to in 0..expected.len() {
                let result = reorder_playlist_item_at(
                    &crate::storage::lock_storage().unwrap(),
                    &path,
                    "test",
                    from,
                    to,
                )
                .unwrap();
                assert_eq!(result[0].items.len(), expected.len());
                let mut actual: Vec<_> = result[0].items.iter().map(|item| &item.bvid).collect();
                actual.sort();
                // Comparing sorted lists also verifies multiplicity, not just set membership.
                assert_eq!(actual, expected);
            }
        }
        fs::remove_file(path).unwrap();
    }

    fn playlist_order_fixture() -> (PathBuf, PlaylistsFile) {
        let file = PlaylistsFile {
            version: VERSION,
            playlists: ["alpha", "beta", "gamma", "empty"]
                .into_iter()
                .map(|id| Playlist {
                    id: id.to_owned(),
                    name: format!("歌单 {id}"),
                    created_at: "1".to_owned(),
                    items: if id == "empty" {
                        Vec::new()
                    } else {
                        vec![
                            track(&format!("{id} first")),
                            TrackSnapshot {
                                bvid: "BV1gB7m6eEHm".to_owned(),
                                ..track(&format!("{id} second"))
                            },
                        ]
                    },
                })
                .collect(),
        };
        let path =
            std::env::temp_dir().join(format!("bili-music-playlist-order-{}.json", Uuid::new_v4()));
        // Preserve compact bytes so a no-op rewrite through write_json_atomic is detectable.
        fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
        (path, file)
    }

    #[test]
    fn playlist_order_moves_forward() {
        let (path, original) = playlist_order_fixture();
        let result =
            reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, 0, 3).unwrap();
        let expected = [1, 2, 3, 0].map(|index| &original.playlists[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: PlaylistsFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(persisted.version, 1);
        assert_eq!(
            serde_json::to_value(persisted.playlists).unwrap(),
            serde_json::to_value(result).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn playlist_order_moves_backward() {
        let (path, original) = playlist_order_fixture();
        let result =
            reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, 3, 1).unwrap();
        let expected = [0, 3, 1, 2].map(|index| &original.playlists[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: PlaylistsFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(
            serde_json::to_value(persisted.playlists).unwrap(),
            serde_json::to_value(result).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn playlist_order_same_index_does_not_write() {
        let (path, original) = playlist_order_fixture();
        let before = fs::read(&path).unwrap();
        let result =
            reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, 2, 2).unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(original.playlists).unwrap()
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn playlist_order_out_of_bounds_leaves_data_unchanged() {
        let (path, original) = playlist_order_fixture();
        let before = fs::read(&path).unwrap();
        let len = original.playlists.len();
        for (from, to) in [
            (len, 0),
            (0, len),
            (len, len),
            (usize::MAX, 0),
            (0, usize::MAX),
        ] {
            assert!(
                reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, from, to)
                    .is_err()
            );
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        let empty = serde_json::to_vec(&PlaylistsFile::default()).unwrap();
        fs::write(&path, &empty).unwrap();
        assert!(
            reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, 0, 0).is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), empty);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn playlist_order_preserves_count_and_ids() {
        let (path, original) = playlist_order_fixture();
        let mut expected: Vec<_> = original
            .playlists
            .iter()
            .map(|playlist| &playlist.id)
            .collect();
        expected.sort();
        for from in 0..expected.len() {
            for to in 0..expected.len() {
                let result =
                    reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, from, to)
                        .unwrap();
                assert_eq!(result.len(), expected.len());
                let mut actual: Vec<_> = result.iter().map(|playlist| &playlist.id).collect();
                actual.sort();
                assert_eq!(actual, expected);
            }
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn playlist_order_preserves_each_playlist_contents() {
        let (path, original) = playlist_order_fixture();
        for from in 0..original.playlists.len() {
            for to in 0..original.playlists.len() {
                reorder_playlist_at(&crate::storage::lock_storage().unwrap(), &path, from, to)
                    .unwrap();
                let persisted: PlaylistsFile =
                    read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
                for expected in &original.playlists {
                    let actual = persisted
                        .playlists
                        .iter()
                        .find(|playlist| playlist.id == expected.id)
                        .unwrap();
                    // Compare the entire playlist, including every song field and its array position.
                    assert_eq!(
                        serde_json::to_value(actual).unwrap(),
                        serde_json::to_value(expected).unwrap()
                    );
                }
            }
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn add_to_playlist_rejects_duplicates_without_writing() {
        let path = std::env::temp_dir().join(format!("bili-add-{}.json", Uuid::new_v4()));
        let created = create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "歌单".into(),
            vec![input("BV1rW4y1Q7o7")],
        )
        .unwrap();
        let before = fs::read(&path).unwrap();
        let error = add_to_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "不存在".into(),
            input("BV1rW4y1Q7o7"),
        )
        .unwrap_err();
        assert!(error.contains("不存在"));
        let playlists = add_to_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            created.id.clone(),
            input("BV1rW4y1Q7o7"),
        )
        .unwrap_err();
        assert!(playlists.contains("歌曲已在歌单“歌单”中"));
        // 大小写不同的 BV 号也应视为重复。
        let error = add_to_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            created.id.clone(),
            input("BV1RW4Y1Q7O7"),
        )
        .unwrap_err();
        assert!(error.contains("歌曲已在歌单"));
        assert_eq!(fs::read(&path).unwrap(), before);
        add_to_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            created.id,
            input("BV1cs411f7ZC"),
        )
        .unwrap();
        let file: PlaylistsFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(file.playlists[0].items.len(), 2);
        fs::remove_file(path).unwrap();
    }

    fn input(bvid: &str) -> TrackSnapshotInput {
        TrackSnapshotInput {
            bvid: bvid.into(),
            title: "  歌名  ".into(),
            uploader: "  ".into(),
            thumbnail_url: " https://example.com/cover.jpg ".into(),
            duration_seconds: 12,
        }
    }

    #[test]
    fn import_normalizes_deduplicates_and_preserves_existing_playlists() {
        let path = std::env::temp_dir().join(format!("bili-import-{}.json", Uuid::new_v4()));
        let first = create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "原歌单".into(),
            vec![input("BV1rW4y1Q7o7")],
        )
        .unwrap();
        let created = create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "  新歌单  ".into(),
            vec![input("BV1rW4y1Q7o7"), input("BV1RW4Y1Q7O7")],
        )
        .unwrap();
        assert_eq!(created.name, "新歌单");
        assert_eq!(created.items.len(), 1);
        assert_eq!(created.items[0].title, "歌名");
        assert_eq!(created.items[0].uploader, "未知 UP 主");
        assert_eq!(
            created.items[0].thumbnail_url,
            "https://example.com/cover.jpg"
        );
        let file: PlaylistsFile =
            read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
        assert_eq!(file.version, VERSION);
        assert_eq!(file.playlists.len(), 2);
        assert_eq!(file.playlists[0].id, first.id);
        let before = fs::read(&path).unwrap();
        assert!(create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "新歌单".into(),
            vec![input("BV1rW4y1Q7o7")]
        )
        .is_err());
        assert!(create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "坏输入".into(),
            vec![input("BV1rW4y1Q7o7"), input("bad")]
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn import_rejects_bad_files_and_invalid_sizes_without_writing() {
        let path = std::env::temp_dir().join(format!("bili-import-{}.json", Uuid::new_v4()));
        for contents in ["broken", r#"{"version":999,"playlists":[]}"#] {
            fs::write(&path, contents).unwrap();
            assert!(create_imported_playlist_at(
                &crate::storage::lock_storage().unwrap(),
                &path,
                "歌单".into(),
                vec![input("BV1rW4y1Q7o7")]
            )
            .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        }
        fs::remove_file(&path).unwrap();
        assert!(create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "歌单".into(),
            vec![]
        )
        .is_err());
        assert!(create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            "歌单".into(),
            (0..201).map(|_| input("BV1rW4y1Q7o7")).collect()
        )
        .is_err());
        assert!(create_imported_playlist_at(
            &crate::storage::lock_storage().unwrap(),
            &path,
            " ".into(),
            vec![input("BV1rW4y1Q7o7")]
        )
        .is_err());
        assert!(!path.exists());
    }
}
