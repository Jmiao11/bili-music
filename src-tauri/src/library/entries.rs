use super::{normalize_bvid, now_string, TrackSnapshot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSnapshot {
    pub fetched_at: String,
    pub items: Vec<TrackSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCollection {
    pub collection_id: i64,
    pub anchor_bvid: String,
    pub title: String,
    pub thumbnail_url: String,
    pub video_count: usize,
    pub added_at: String,
    pub snapshot: CollectionSnapshot,
    pub source_status: CollectionSourceStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CollectionSourceStatus {
    Active,
    Invalid,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LibraryEntry {
    Video {
        #[serde(rename = "entryId")]
        entry_id: String,
        video: TrackSnapshot,
    },
    Collection {
        #[serde(rename = "entryId")]
        entry_id: String,
        #[serde(flatten)]
        collection: LibraryCollection,
    },
}

impl From<TrackSnapshot> for LibraryEntry {
    fn from(video: TrackSnapshot) -> Self {
        Self::Video {
            entry_id: format!("video:{}", video.bvid.to_ascii_lowercase()),
            video,
        }
    }
}

impl LibraryEntry {
    pub fn entry_id(&self) -> &str {
        match self {
            Self::Video { entry_id, .. } | Self::Collection { entry_id, .. } => entry_id,
        }
    }
    pub fn video(&self) -> Option<&TrackSnapshot> {
        match self {
            Self::Video { video, .. } => Some(video),
            _ => None,
        }
    }
    pub fn is_video(&self, bvid: &str) -> bool {
        self.video()
            .is_some_and(|video| video.bvid.eq_ignore_ascii_case(bvid))
    }
    pub fn collection_id(&self) -> Option<i64> {
        match self {
            Self::Collection { collection, .. } => Some(collection.collection_id),
            _ => None,
        }
    }
    pub fn key(&self) -> String {
        match self {
            Self::Video { video, .. } => format!("video:{}", video.bvid.to_ascii_lowercase()),
            Self::Collection { collection, .. } => {
                format!("collection:{}", collection.collection_id)
            }
        }
    }
    pub fn new_collection(mut collection: LibraryCollection) -> Result<Self, String> {
        collection.validate()?;
        collection.added_at = now_string();
        Ok(Self::Collection {
            entry_id: uuid::Uuid::new_v4().to_string(),
            collection,
        })
    }
}

impl LibraryCollection {
    pub fn validate(&self) -> Result<(), String> {
        if self.collection_id <= 0
            || self.title.trim().is_empty()
            || self.video_count == 0
            || self.snapshot.fetched_at.parse::<u128>().is_err()
            || self.video_count != self.snapshot.items.len()
        {
            return Err("合集快照不完整。".to_owned());
        }
        if normalize_bvid(&self.anchor_bvid).map_err(|_| "合集来源 BV 无效。")? != self.anchor_bvid
        {
            return Err("合集来源 BV 无效。".to_owned());
        }
        let mut known = HashSet::new();
        for item in &self.snapshot.items {
            if normalize_bvid(&item.bvid).map_err(|_| "合集成员 BV 无效。")? != item.bvid {
                return Err("合集成员 BV 无效。".to_owned());
            }
            if !known.insert(item.bvid.to_ascii_lowercase()) {
                return Err("合集快照包含重复视频。".to_owned());
            }
        }
        Ok(())
    }
}

pub(super) fn decode_entries(
    version: u32,
    values: Vec<Value>,
) -> Result<Vec<LibraryEntry>, String> {
    if version != 1 && version != 2 {
        return Err(format!("资料库数据版本 {version} 暂不支持。"));
    }
    let mut keys = HashSet::new();
    let mut ids = HashSet::new();
    values
        .into_iter()
        .map(|value| {
            let entry = if version == 1 {
                LibraryEntry::from(
                    serde_json::from_value::<TrackSnapshot>(value)
                        .map_err(|_| "视频条目格式无效。")?,
                )
            } else {
                let entry: LibraryEntry =
                    serde_json::from_value(value).map_err(|_| "资料库条目格式无效。")?;
                if entry.entry_id().is_empty() {
                    return Err("资料库条目缺少身份。".to_owned());
                }
                match &entry {
                    LibraryEntry::Video { entry_id, video } => {
                        if normalize_bvid(&video.bvid).map_err(|_| "视频条目 BV 无效。")?
                            != video.bvid
                        {
                            return Err("视频条目 BV 无效。".to_owned());
                        }
                        if entry_id != &format!("video:{}", video.bvid.to_ascii_lowercase()) {
                            return Err("视频条目身份无效。".to_owned());
                        }
                    }
                    LibraryEntry::Collection { collection, .. } => collection.validate()?,
                }
                entry
            };
            if version == 2
                && (!keys.insert(entry.key()) || !ids.insert(entry.entry_id().to_owned()))
            {
                return Err("资料库包含重复条目。".to_owned());
            }
            Ok(entry)
        })
        .collect()
}

pub(super) fn entries_json(
    entries: &[LibraryEntry],
    version: u32,
) -> Result<Value, serde_json::Error> {
    if version == 1 {
        serde_json::to_value(
            entries
                .iter()
                .filter_map(LibraryEntry::video)
                .collect::<Vec<_>>(),
        )
    } else {
        serde_json::to_value(entries)
    }
}

pub(super) fn entries_version(entries: &[LibraryEntry]) -> u32 {
    if entries.iter().any(|entry| entry.collection_id().is_some()) {
        2
    } else {
        1
    }
}

// Called under the same storage lock as the following atomic write, including ZIP imports.
pub(super) fn backup_before_v2(
    guard: &crate::storage::StorageGuard,
    path: &Path,
) -> Result<(), String> {
    let bytes = match crate::storage::read(guard, path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法读取升级前的资料库，未写入 v2。".to_owned()),
    };
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "升级前的资料库格式损坏，未写入 v2。")?;
    if value.get("version").and_then(Value::as_u64) == Some(2) {
        return Ok(());
    }
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("升级前的资料库版本无效，未写入 v2。".to_owned());
    }
    let backup = path.with_extension("v1.bak.json");
    crate::storage::backup_once(guard, &backup, &bytes)
        .map_err(|_| "无法创建 v1 自动备份，未写入 v2，原文件保持不变。".to_owned())?;
    // A failed earlier copy must never make a truncated, already-existing file count as a backup.
    let saved =
        crate::storage::read(guard, &backup).map_err(|_| "无法校验 v1 自动备份，未写入 v2。")?;
    let version = serde_json::from_slice::<Value>(&saved)
        .ok()
        .and_then(|value| value.get("version").and_then(Value::as_u64));
    let valid = if path.file_name().and_then(|name| name.to_str()) == Some("playlists.json") {
        super::playlists::validate_import_json("playlists.json", &saved)
    } else {
        super::favorites::validate_import_json("favorites.json", &saved)
    };
    if version != Some(1) || valid.is_err() {
        return Err("现有 v1 自动备份无效，未覆盖备份或原文件。".to_owned());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::library::{
        collections, favorites, playlists, read_json_or_default, test_support::track,
    };
    use std::fs;
    use std::path::PathBuf;

    fn root() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("bili-collection-library-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        crate::storage::set_test_root(root.clone());
        root
    }
    pub(crate) fn collection() -> LibraryCollection {
        LibraryCollection {
            collection_id: 31,
            anchor_bvid: "BV1rW4y1Q7o7".to_owned(),
            title: "测试合集".to_owned(),
            thumbnail_url: String::new(),
            video_count: 2,
            added_at: "1".to_owned(),
            snapshot: CollectionSnapshot {
                fetched_at: "1000".to_owned(),
                items: vec![
                    track("一"),
                    TrackSnapshot {
                        bvid: "BV1gB7m6eEHm".to_owned(),
                        ..track("二")
                    },
                ],
            },
            source_status: CollectionSourceStatus::Active,
        }
    }
    fn v1() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"version":1,"items":[track("原视频")]})).unwrap()
    }
    fn stored_version(path: &Path) -> u64 {
        serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["version"]
            .as_u64()
            .unwrap()
    }

    #[test]
    fn v1_read_converts_in_memory_without_write_and_video_only_remains_v1() {
        let root = root();
        let path = root.join("favorites.json");
        let original = v1();
        fs::write(&path, &original).unwrap();
        {
            let guard = crate::storage::lock_storage().unwrap();
            let mut file: favorites::FavoritesFile = read_json_or_default(&guard, &path).unwrap();
            assert_eq!(file.items[0].entry_id(), "video:bv1rw4y1q7o7");
            assert_eq!(fs::read(&path).unwrap(), original);
            file.items.push(
                TrackSnapshot {
                    bvid: "BV1gB7m6eEHm".to_owned(),
                    ..track("普通视频")
                }
                .into(),
            );
            favorites::write_favorites(&guard, &path, &file).unwrap();
        }
        assert_eq!(stored_version(&path), 1);
        assert!(!root.join("favorites.v1.bak.json").exists());
        let wire: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(wire["items"][0].get("entryId").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn first_v2_write_backs_up_exact_v1_once_and_last_collection_removal_returns_to_v1() {
        let root = root();
        let path = root.join("favorites.json");
        let original = v1();
        fs::write(&path, &original).unwrap();
        let added = collections::toggle_collection_favorite(collection()).unwrap();
        assert!(added.favorited);
        assert_eq!(stored_version(&path), 2);
        assert_eq!(
            fs::read(root.join("favorites.v1.bak.json")).unwrap(),
            original
        );
        let mut changed = collection();
        changed.title = "变更后".to_owned();
        assert!(collections::update_collection_entry(
            added.items[0].entry_id().to_owned(),
            None,
            changed
        )
        .unwrap());
        assert_eq!(
            fs::read(root.join("favorites.v1.bak.json")).unwrap(),
            original
        );
        collections::remove_collection_entry(added.items[0].entry_id().to_owned(), None).unwrap();
        assert_eq!(stored_version(&path), 1);
        assert_eq!(favorites::list_favorites().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_v1_backup_is_not_overwritten_and_backup_failure_prevents_v2_write() {
        let root = root();
        let path = root.join("favorites.json");
        let original = v1();
        fs::write(&path, &original).unwrap();
        let backup = root.join("favorites.v1.bak.json");
        let previous = br#"{"version":1,"items":[]}"#;
        fs::write(&backup, previous).unwrap();
        collections::toggle_collection_favorite(collection()).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), previous);
        fs::write(&path, &original).unwrap();
        fs::remove_file(&backup).unwrap();
        fs::create_dir(&backup).unwrap();
        let error = collections::toggle_collection_favorite(collection()).unwrap_err();
        assert!(error.contains("自动备份"));
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_dir(&backup).unwrap();
        fs::write(&backup, b"{truncated").unwrap();
        assert!(collections::toggle_collection_favorite(collection())
            .unwrap_err()
            .contains("备份无效"));
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read(&backup).unwrap(), b"{truncated");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_requires_complete_unique_members_matching_id_and_surviving_entry_id() {
        let mut entry = LibraryEntry::new_collection(collection()).unwrap();
        let id = entry.entry_id().to_owned();
        let original = serde_json::to_value(&entry).unwrap();
        let mut broken = collection();
        broken.snapshot.items.pop();
        assert!(collections::replace_snapshot(&mut entry, &id, broken).is_err());
        let mut wrong = collection();
        wrong.collection_id += 1;
        assert!(collections::replace_snapshot(&mut entry, &id, wrong).is_err());
        let mut duplicate = collection();
        duplicate.snapshot.items[1] = duplicate.snapshot.items[0].clone();
        assert!(collections::replace_snapshot(&mut entry, &id, duplicate).is_err());
        assert!(!collections::replace_snapshot(&mut entry, "deleted-entry", collection()).unwrap());
        assert_eq!(serde_json::to_value(entry).unwrap(), original);
    }

    #[test]
    fn existing_collection_can_shrink_to_one_member_without_becoming_invalid() {
        let mut entry = LibraryEntry::new_collection(collection()).unwrap();
        let id = entry.entry_id().to_owned();
        let mut smaller = collection();
        smaller.snapshot.items.truncate(1);
        smaller.video_count = 1;
        assert!(collections::replace_snapshot(&mut entry, &id, smaller).unwrap());
        let LibraryEntry::Collection { collection, .. } = entry else {
            panic!("expected collection");
        };
        assert_eq!(collection.video_count, 1);
        assert_eq!(collection.source_status, CollectionSourceStatus::Active);
    }

    #[test]
    fn deleted_then_readded_collection_discards_late_refresh_without_resurrecting_reference() {
        let root = root();
        let first = collections::toggle_collection_favorite(collection()).unwrap();
        let old_id = first.items[0].entry_id().to_owned();
        collections::remove_collection_entry(old_id.clone(), None).unwrap();
        let second = collections::toggle_collection_favorite(collection()).unwrap();
        assert_ne!(second.items[0].entry_id(), old_id);
        let path = root.join("favorites.json");
        let before = fs::read(&path).unwrap();
        assert!(!collections::update_collection_entry(old_id, None, collection()).unwrap());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mixed_reorder_survives_reload_and_bulk_add_deduplicates_only_individual_videos() {
        let root = root();
        let playlists = playlists::create_playlist("混排".to_owned()).unwrap();
        let id = playlists[0].id.clone();
        let input = || super::super::TrackSnapshotInput {
            bvid: collection().anchor_bvid,
            title: "单视频".to_owned(),
            uploader: "作者".to_owned(),
            thumbnail_url: String::new(),
            duration_seconds: 1,
        };
        playlists::add_to_playlist(id.clone(), input()).unwrap();
        let mixed = collections::add_collection_to_playlist(id.clone(), collection()).unwrap();
        let entry_id = mixed[0].items[1].entry_id().to_owned();
        playlists::reorder_playlist_item(id.clone(), 1, 0).unwrap();
        assert_eq!(
            playlists::list_playlists().unwrap()[0].items[0].entry_id(),
            entry_id
        );
        let result =
            collections::add_collection_videos_to_playlist(id.clone(), collection()).unwrap();
        assert_eq!((result.added, result.duplicates), (1, 1));
        assert_eq!(result.playlists[0].items.len(), 3);
        assert!(root.join("playlists.v1.bak.json").is_file());
        let again = collections::add_collection_videos_to_playlist(id, collection()).unwrap();
        assert_eq!((again.added, again.duplicates), (0, 2));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_9bc3ec8_reader_rejects_v2_without_overwriting() {
        // DTO and Versioned/read-before-write path from 9bc3ec8; the shared VERSION and reader remain unchanged.
        #[derive(Deserialize, Serialize)]
        struct OldFavorites {
            version: u32,
            items: Vec<TrackSnapshot>,
        }
        impl Default for OldFavorites {
            fn default() -> Self {
                Self {
                    version: 1,
                    items: Vec::new(),
                }
            }
        }
        impl super::super::Versioned for OldFavorites {
            fn version(&self) -> u32 {
                self.version
            }
        }
        let root = root();
        collections::toggle_collection_favorite(collection()).unwrap();
        let path = root.join("favorites.json");
        let before = fs::read(&path).unwrap();
        let guard = crate::storage::lock_storage().unwrap();
        let attempt = (|| -> Result<(), String> {
            let old: OldFavorites = read_json_or_default(&guard, &path)?;
            super::super::write_json_atomic(&guard, &path, &old)
        })();
        assert!(attempt.is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        drop(guard);
        #[derive(Deserialize, Serialize)]
        #[serde(rename_all = "camelCase")]
        struct OldPlaylist {
            id: String,
            name: String,
            created_at: String,
            items: Vec<TrackSnapshot>,
        }
        #[derive(Deserialize, Serialize)]
        struct OldPlaylists {
            version: u32,
            playlists: Vec<OldPlaylist>,
        }
        impl Default for OldPlaylists {
            fn default() -> Self {
                Self {
                    version: 1,
                    playlists: Vec::new(),
                }
            }
        }
        impl super::super::Versioned for OldPlaylists {
            fn version(&self) -> u32 {
                self.version
            }
        }
        let id = playlists::create_playlist("旧版测试".to_owned()).unwrap()[0]
            .id
            .clone();
        collections::add_collection_to_playlist(id, collection()).unwrap();
        let path = root.join("playlists.json");
        let before = fs::read(&path).unwrap();
        let guard = crate::storage::lock_storage().unwrap();
        let attempt = (|| -> Result<(), String> {
            let old: OldPlaylists = read_json_or_default(&guard, &path)?;
            super::super::write_json_atomic(&guard, &path, &old)
        })();
        assert!(attempt.is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        drop(guard);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn purging_an_unavailable_member_keeps_the_collection_and_its_snapshot() {
        let root = root();
        let data = collection();
        let input = || super::super::TrackSnapshotInput {
            bvid: data.anchor_bvid.clone(),
            title: "单视频".to_owned(),
            uploader: "作者".to_owned(),
            thumbnail_url: String::new(),
            duration_seconds: 60,
        };
        favorites::toggle_favorite(input()).unwrap();
        collections::toggle_collection_favorite(data.clone()).unwrap();
        let id = playlists::create_playlist("测试".to_owned()).unwrap()[0]
            .id
            .clone();
        playlists::add_to_playlist(id.clone(), input()).unwrap();
        collections::add_collection_to_playlist(id, data.clone()).unwrap();
        super::super::unavailable::mark_track_unavailable(
            data.anchor_bvid,
            "成员已删除".to_owned(),
        )
        .unwrap();
        let removed = super::super::unavailable::purge_unavailable_tracks().unwrap();
        assert_eq!(
            (removed.removed_favorites, removed.removed_playlist_items),
            (1, 1)
        );
        let favorites = favorites::list_favorites().unwrap();
        let playlists = playlists::list_playlists().unwrap();
        assert_eq!(favorites.len(), 1);
        assert_eq!(playlists[0].items.len(), 1);
        for entry in [&favorites[0], &playlists[0].items[0]] {
            let LibraryEntry::Collection { collection, .. } = entry else {
                panic!("collection must survive");
            };
            assert_eq!(collection.snapshot.items.len(), 2);
            assert_eq!(collection.source_status, CollectionSourceStatus::Active);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
