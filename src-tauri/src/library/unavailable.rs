use super::favorites::{favorites_path, FavoritesFile};
use super::playlists::{playlists_path, PlaylistsFile};
use super::{
    library_file_path, normalize_bvid, now_millis, read_json_or_default, write_json_atomic,
    Versioned, UNAVAILABLE_TRACKS_FILE, VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

const MAX_UNAVAILABLE_TRACKS: usize = 500;
// ponytail: 单文件锁串行化读写，拆分存储后再按文件细分。
static UNAVAILABLE_TRACKS_FILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableTrack {
    pub bvid: String,
    pub reason: String,
    pub marked_at: u128,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeResult {
    pub removed_favorites: usize,
    pub removed_playlist_items: usize,
    pub cleared_marks: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct UnavailableTracksFile {
    version: u32,
    items: Vec<UnavailableTrack>,
}

impl Default for UnavailableTracksFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
        }
    }
}

impl Versioned for UnavailableTracksFile {
    fn version(&self) -> u32 {
        self.version
    }
}

fn mark_track_unavailable_at(
    path: &Path,
    bvid: &str,
    reason: String,
    marked_at: u128,
) -> Result<(), String> {
    let bvid = normalize_bvid(bvid)?;
    let mut file: UnavailableTracksFile = read_json_or_default(path)?;
    file.items
        .retain(|item| !item.bvid.eq_ignore_ascii_case(&bvid));
    file.items.push(UnavailableTrack {
        bvid,
        reason,
        marked_at,
    });
    file.items
        .sort_by_key(|item| std::cmp::Reverse(item.marked_at));
    file.items.truncate(MAX_UNAVAILABLE_TRACKS);
    write_json_atomic(path, &file)
}

#[tauri::command]
pub fn mark_track_unavailable(bvid: String, reason: String) -> Result<(), String> {
    let _lock = UNAVAILABLE_TRACKS_FILE_LOCK
        .lock()
        .map_err(|_| "失效曲目数据锁异常。")?;
    mark_track_unavailable_at(
        &library_file_path(UNAVAILABLE_TRACKS_FILE)?,
        &bvid,
        reason,
        now_millis(),
    )
}

fn clear_track_unavailable_at(path: &Path, bvid: &str) -> Result<(), String> {
    let bvid = normalize_bvid(bvid)?;
    let mut file: UnavailableTracksFile = read_json_or_default(path)?;
    let original_len = file.items.len();
    file.items
        .retain(|item| !item.bvid.eq_ignore_ascii_case(&bvid));
    if file.items.len() == original_len {
        return Ok(());
    }
    write_json_atomic(path, &file)
}

#[tauri::command]
pub fn clear_track_unavailable(bvid: String) -> Result<(), String> {
    let _lock = UNAVAILABLE_TRACKS_FILE_LOCK
        .lock()
        .map_err(|_| "失效曲目数据锁异常。")?;
    clear_track_unavailable_at(&library_file_path(UNAVAILABLE_TRACKS_FILE)?, &bvid)
}

fn list_unavailable_tracks_at(path: &Path) -> Result<Vec<UnavailableTrack>, String> {
    Ok(read_json_or_default::<UnavailableTracksFile>(path)?.items)
}

#[tauri::command]
pub fn list_unavailable_tracks() -> Result<Vec<UnavailableTrack>, String> {
    let _lock = UNAVAILABLE_TRACKS_FILE_LOCK
        .lock()
        .map_err(|_| "失效曲目数据锁异常。")?;
    list_unavailable_tracks_at(&library_file_path(UNAVAILABLE_TRACKS_FILE)?)
}

fn purge_unavailable_tracks_at(
    favorites_path: &Path,
    playlists_path: &Path,
    unavailable_path: &Path,
) -> Result<PurgeResult, String> {
    let unavailable: UnavailableTracksFile = read_json_or_default(unavailable_path)?;
    if unavailable.items.is_empty() {
        return Ok(PurgeResult::default());
    }

    let unavailable_bvids: HashSet<String> = unavailable
        .items
        .iter()
        .map(|item| item.bvid.to_lowercase())
        .collect();
    let mut favorites: FavoritesFile = read_json_or_default(favorites_path)?;
    let mut playlists: PlaylistsFile = read_json_or_default(playlists_path)?;

    let favorites_before = favorites.items.len();
    favorites
        .items
        .retain(|item| !unavailable_bvids.contains(&item.bvid.to_lowercase()));
    let removed_favorites = favorites_before - favorites.items.len();

    let mut removed_playlist_items = 0;
    for playlist in &mut playlists.playlists {
        let items_before = playlist.items.len();
        playlist
            .items
            .retain(|item| !unavailable_bvids.contains(&item.bvid.to_lowercase()));
        removed_playlist_items += items_before - playlist.items.len();
    }

    if removed_favorites > 0 {
        write_json_atomic(favorites_path, &favorites)?;
    }
    if removed_playlist_items > 0 {
        write_json_atomic(playlists_path, &playlists)?;
    }

    let _lock = UNAVAILABLE_TRACKS_FILE_LOCK
        .lock()
        .map_err(|_| "失效曲目数据锁异常。")?;
    write_json_atomic(unavailable_path, &UnavailableTracksFile::default())?;

    Ok(PurgeResult {
        removed_favorites,
        removed_playlist_items,
        cleared_marks: unavailable.items.len(),
    })
}

#[tauri::command]
pub fn purge_unavailable_tracks() -> Result<PurgeResult, String> {
    purge_unavailable_tracks_at(
        &favorites_path()?,
        &playlists_path()?,
        &library_file_path(UNAVAILABLE_TRACKS_FILE)?,
    )
}

#[cfg(test)]
mod tests {
    use super::super::playlists::Playlist;
    use super::super::test_support::{test_path, track};
    use super::super::TrackSnapshot;
    use super::*;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn unavailable_tracks_mark_update_list_and_clear() {
        let path = test_path();
        super::mark_track_unavailable_at(
            &path,
            "BV1GF4X6MEb1",
            "该视频已被删除或设为私密".into(),
            100,
        )
        .unwrap();
        super::mark_track_unavailable_at(
            &path,
            "BV1GF4X6MEB1",
            "该视频没有可播放的音频".into(),
            200,
        )
        .unwrap();

        let items = super::list_unavailable_tracks_at(&path).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].bvid, "BV1GF4X6MEB1");
        assert_eq!(items[0].reason, "该视频没有可播放的音频");
        assert_eq!(items[0].marked_at, 200);

        super::clear_track_unavailable_at(&path, "BV1GF4X6MEb1").unwrap();
        assert!(super::list_unavailable_tracks_at(&path).unwrap().is_empty());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn unavailable_tracks_reject_invalid_bvid_without_writing() {
        let path = test_path();
        assert!(super::mark_track_unavailable_at(&path, "av123", "失效".into(), 1).is_err());
        assert!(super::clear_track_unavailable_at(&path, "av123").is_err());
        assert!(!path.exists());
    }

    #[test]
    fn unavailable_tracks_evict_oldest_mark() {
        let path = test_path();
        let file = super::UnavailableTracksFile {
            version: VERSION,
            items: (0..500)
                .map(|index| super::UnavailableTrack {
                    bvid: format!("BV{index:010}"),
                    reason: "失效".into(),
                    marked_at: if index == 123 { 0 } else { index + 1 },
                })
                .collect(),
        };
        write_json_atomic(&path, &file).unwrap();
        super::mark_track_unavailable_at(
            &path,
            "BV9999999999",
            "该视频已被删除或设为私密".into(),
            1000,
        )
        .unwrap();

        let items = super::list_unavailable_tracks_at(&path).unwrap();
        assert_eq!(items.len(), 500);
        assert_eq!(items[0].bvid, "BV9999999999");
        assert!(!items.iter().any(|item| item.bvid == "BV0000000123"));
        assert!(items.iter().any(|item| item.bvid == "BV0000000000"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn unavailable_tracks_reject_unsupported_version_without_overwriting() {
        let path = test_path();
        let bytes = r#"{"version":999,"items":[]}"#;
        fs::write(&path, bytes).unwrap();
        assert!(super::list_unavailable_tracks_at(&path).is_err());
        assert!(super::mark_track_unavailable_at(&path, "BV1GF4X6MEb1", "失效".into(), 1).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn purge_unavailable_tracks_removes_every_occurrence_and_clears_marks() {
        let root = std::env::temp_dir().join(format!("bili-music-purge-{}", Uuid::new_v4()));
        let favorites_path = root.join("favorites.json");
        let playlists_path = root.join("playlists.json");
        let unavailable_path = root.join("unavailable-tracks.json");
        let unavailable_bvid = "BV1GF4X6MEb1";
        let kept_bvid = "BV1rW4y1Q7o7";

        write_json_atomic(
            &favorites_path,
            &FavoritesFile {
                version: VERSION,
                items: vec![
                    track_with_bvid(unavailable_bvid, "失效收藏"),
                    track_with_bvid(kept_bvid, "保留收藏"),
                ],
            },
        )
        .unwrap();
        write_json_atomic(
            &playlists_path,
            &PlaylistsFile {
                version: VERSION,
                playlists: vec![
                    Playlist {
                        id: "one".into(),
                        name: "歌单一".into(),
                        created_at: "1".into(),
                        items: vec![
                            track_with_bvid(unavailable_bvid, "失效一"),
                            track_with_bvid(kept_bvid, "保留歌曲"),
                        ],
                    },
                    Playlist {
                        id: "two".into(),
                        name: "歌单二".into(),
                        created_at: "2".into(),
                        items: vec![track_with_bvid("BV1GF4X6MEB1", "失效二")],
                    },
                ],
            },
        )
        .unwrap();
        write_json_atomic(
            &unavailable_path,
            &super::UnavailableTracksFile {
                version: VERSION,
                items: vec![
                    super::UnavailableTrack {
                        bvid: unavailable_bvid.into(),
                        reason: "该视频已被删除或设为私密".into(),
                        marked_at: 2,
                    },
                    super::UnavailableTrack {
                        bvid: "BV0000000000".into(),
                        reason: "该视频没有可播放的音频".into(),
                        marked_at: 1,
                    },
                ],
            },
        )
        .unwrap();

        let result =
            super::purge_unavailable_tracks_at(&favorites_path, &playlists_path, &unavailable_path)
                .unwrap();

        assert_eq!(result.removed_favorites, 1);
        assert_eq!(result.removed_playlist_items, 2);
        assert_eq!(result.cleared_marks, 2);
        let favorites: FavoritesFile = read_json_or_default(&favorites_path).unwrap();
        assert_eq!(favorites.items.len(), 1);
        assert_eq!(favorites.items[0].bvid, kept_bvid);
        let playlists: PlaylistsFile = read_json_or_default(&playlists_path).unwrap();
        assert_eq!(playlists.playlists[0].items.len(), 1);
        assert_eq!(playlists.playlists[0].items[0].bvid, kept_bvid);
        assert!(playlists.playlists[1].items.is_empty());
        let unavailable: super::UnavailableTracksFile =
            read_json_or_default(&unavailable_path).unwrap();
        assert!(unavailable.items.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn purge_unavailable_tracks_without_marks_does_not_write_files() {
        let root = std::env::temp_dir().join(format!("bili-music-purge-{}", Uuid::new_v4()));
        let result = super::purge_unavailable_tracks_at(
            &root.join("favorites.json"),
            &root.join("playlists.json"),
            &root.join("unavailable-tracks.json"),
        )
        .unwrap();

        assert_eq!(result.removed_favorites, 0);
        assert_eq!(result.removed_playlist_items, 0);
        assert_eq!(result.cleared_marks, 0);
        assert!(!root.exists());
    }

    #[cfg(windows)]
    #[test]
    fn purge_second_write_failure_keeps_first_write_and_marks() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = std::env::temp_dir().join(format!("bili-music-purge-{}", Uuid::new_v4()));
        let favorites_path = root.join("favorites.json");
        let playlists_path = root.join("playlists.json");
        let unavailable_path = root.join("unavailable-tracks.json");
        let bvid = "BV1GF4X6MEb1";
        write_json_atomic(
            &favorites_path,
            &FavoritesFile {
                version: VERSION,
                items: vec![track_with_bvid(bvid, "失效收藏")],
            },
        )
        .unwrap();
        write_json_atomic(
            &playlists_path,
            &PlaylistsFile {
                version: VERSION,
                playlists: vec![Playlist {
                    id: "one".into(),
                    name: "歌单".into(),
                    created_at: "1".into(),
                    items: vec![track_with_bvid(bvid, "失效歌曲")],
                }],
            },
        )
        .unwrap();
        mark_track_unavailable_at(&unavailable_path, bvid, "失效".into(), 1).unwrap();
        let playlists_before = fs::read(&playlists_path).unwrap();
        let marks_before = fs::read(&unavailable_path).unwrap();
        // 允许读取，但禁止重命名，以确定性地使第二个文件的原子写入失败。
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&playlists_path)
            .unwrap();
        let error =
            purge_unavailable_tracks_at(&favorites_path, &playlists_path, &unavailable_path)
                .unwrap_err();
        assert!(error.contains("无法备份旧资料库"));
        let favorites: FavoritesFile = read_json_or_default(&favorites_path).unwrap();
        assert!(favorites.items.is_empty());
        assert_eq!(fs::read(&playlists_path).unwrap(), playlists_before);
        assert_eq!(fs::read(&unavailable_path).unwrap(), marks_before);
        drop(held);
        fs::remove_dir_all(root).unwrap();
    }

    fn track_with_bvid(bvid: &str, title: &str) -> TrackSnapshot {
        TrackSnapshot {
            bvid: bvid.into(),
            ..track(title)
        }
    }
}
