use super::{
    library_file_path, read_json_or_default, write_json_atomic, TrackSnapshot, Versioned,
    PLAYBACK_STATE_FILE,
};
use serde::{Deserialize, Serialize};
pub(super) fn validate_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<PlaybackState>(file_name, bytes)
}

#[cfg(test)]
use std::fs;
use std::path::{Path, PathBuf};

const PLAYBACK_STATE_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCollection {
    pub data: super::entries::LibraryCollection,
    pub member_index: usize,
    pub remaining: Vec<usize>,
    pub played_count: usize,
    pub unit_charged: bool,
    pub charged_units: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_track: Option<TrackSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackQueueEntry {
    #[serde(flatten)]
    pub video: TrackSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<PlaybackCollection>,
}

impl From<TrackSnapshot> for PlaybackQueueEntry {
    fn from(video: TrackSnapshot) -> Self {
        Self {
            video,
            entry_id: None,
            collection: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackHistory {
    pub index: usize,
    pub cid: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_level: Option<bool>,
    pub entry_id: String,
    pub bvid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomPageRound {
    pub bvid: String,
    pub played_count: usize,
    pub remaining: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackTraversal {
    pub random_remaining: Vec<usize>,
    pub history: Vec<PlaybackHistory>,
    pub random_page_round: Option<RandomPageRound>,
    pub shuffle: bool,
    pub loop_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub version: u32,
    pub queue: Vec<PlaybackQueueEntry>,
    pub current_index: usize,
    pub position_seconds: f64,
    pub page: Option<u32>,
    pub cid: Option<u64>,
    pub saved_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traversal: Option<PlaybackTraversal>,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            version: PLAYBACK_STATE_VERSION,
            queue: Vec::new(),
            current_index: 0,
            position_seconds: 0.0,
            page: None,
            cid: None,
            saved_at: 0,
            traversal: None,
        }
    }
}

impl Versioned for PlaybackState {
    fn version(&self) -> u32 {
        self.version
    }

    fn ensure_supported_version(&self, _path: &Path) -> Result<(), String> {
        if !matches!(self.version, 1 | 2) {
            return Err("播放状态版本暂不支持。".to_owned());
        }
        if !self.position_seconds.is_finite() || self.position_seconds < 0.0 {
            return Err("播放位置无效。".to_owned());
        }
        let has_collections = self.queue.iter().any(|entry| entry.collection.is_some());
        if self.version == 1 && (has_collections || self.traversal.is_some()) {
            return Err("v1 播放状态不能包含合集。".to_owned());
        }
        for entry in &self.queue {
            if let Some(group) = &entry.collection {
                group.data.validate()?;
                if let Some(track) = &group.history_track {
                    if super::normalize_bvid(&track.bvid)? != track.bvid {
                        return Err("历史成员 BV 无效。".to_owned());
                    }
                }
                let count = group.data.snapshot.items.len();
                if group.played_count != group.charged_units.len()
                    || group
                        .charged_units
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        != group.charged_units.len()
                {
                    return Err("合集音频计数无效。".to_owned());
                }
                if entry.entry_id.as_deref().is_none_or(str::is_empty)
                    || group.member_index >= count
                    || group
                        .remaining
                        .iter()
                        .any(|&index| index >= count || index == group.member_index)
                    || group
                        .remaining
                        .iter()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        != group.remaining.len()
                {
                    return Err("合集播放游标无效。".to_owned());
                }
            }
        }
        if self.version == 2 {
            let traversal = self.traversal.as_ref().ok_or("缺少播放轮次。")?;
            if self.queue.is_empty()
                || self.current_index >= self.queue.len()
                || !matches!(traversal.loop_mode.as_str(), "sequence" | "list" | "single")
                || traversal
                    .random_remaining
                    .iter()
                    .any(|&index| index >= self.queue.len())
                || traversal
                    .random_remaining
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    != traversal.random_remaining.len()
            {
                return Err("播放轮次无效。".to_owned());
            }
            for history in &traversal.history {
                let entry = self.queue.get(history.index).ok_or("播放历史游标无效。")?;
                let identity = entry
                    .entry_id
                    .clone()
                    .unwrap_or_else(|| format!("video:{}", entry.video.bvid.to_ascii_lowercase()));
                let member_exists = entry.collection.as_ref().map_or_else(
                    || history.bvid == entry.video.bvid,
                    |group| {
                        group
                            .data
                            .snapshot
                            .items
                            .iter()
                            .any(|item| item.bvid == history.bvid)
                    },
                );
                let saved_member = entry.collection.is_some()
                    && history.track.as_ref().is_some_and(|track| {
                        track.bvid == history.bvid
                            && super::normalize_bvid(&track.bvid).as_deref()
                                == Ok(track.bvid.as_str())
                    });
                if history.entry_id != identity
                    || (!member_exists && !saved_member)
                    || history.cid == Some(0)
                {
                    return Err("播放历史身份无效。".to_owned());
                }
            }
        }
        Ok(())
    }
}

pub(super) fn normalize_for_write(mut state: PlaybackState) -> Result<PlaybackState, String> {
    state.version = if state.queue.iter().any(|entry| entry.collection.is_some()) {
        2
    } else {
        1
    };
    if state.version == 1 {
        state.traversal = None;
        for entry in &mut state.queue {
            entry.entry_id = None;
        }
    }
    state.ensure_supported_version(Path::new(PLAYBACK_STATE_FILE))?;
    Ok(state)
}

#[tauri::command]
pub fn get_playback_state() -> Result<Option<PlaybackState>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    get_playback_state_from(guard, &playback_state_path(guard)?)
}

#[tauri::command]
pub fn save_playback_state(state: PlaybackState) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    save_playback_state_to(guard, &playback_state_path(guard)?, state)
}

#[tauri::command]
pub fn clear_playback_state() -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    clear_playback_state_at(guard, &playback_state_path(guard)?)
}

fn playback_state_path(guard: &crate::storage::StorageGuard) -> Result<PathBuf, String> {
    library_file_path(guard, PLAYBACK_STATE_FILE)
}

fn get_playback_state_from(
    guard: &crate::storage::StorageGuard,
    path: &Path,
) -> Result<Option<PlaybackState>, String> {
    let mut state: PlaybackState = match read_json_or_default(guard, path) {
        Ok(state) => state,
        Err(_) => return Ok(None),
    };
    if state.queue.is_empty() {
        return Ok(None);
    }
    state.current_index = state.current_index.min(state.queue.len() - 1);
    Ok(Some(state))
}

fn save_playback_state_to(
    guard: &crate::storage::StorageGuard,
    path: &Path,
    mut state: PlaybackState,
) -> Result<(), String> {
    if state.queue.is_empty() {
        return clear_playback_state_at(guard, path);
    }
    state.queue.truncate(200);
    state.current_index = state.current_index.min(state.queue.len() - 1);
    if let Some(traversal) = &mut state.traversal {
        traversal
            .random_remaining
            .retain(|&index| index < state.queue.len());
        traversal
            .history
            .retain(|entry| entry.index < state.queue.len());
    }
    state = normalize_for_write(state)?;
    if state.version == 2 {
        super::entries::backup_before_v2(guard, path)?;
    }
    write_json_atomic(guard, path, &state)
}

fn clear_playback_state_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
) -> Result<(), String> {
    match crate::storage::remove_file(guard, path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法删除播放状态 {}：{error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{test_path, track};
    use super::*;

    #[test]
    fn clamps_out_of_bounds_playback_index() {
        let path = test_path();
        let state = PlaybackState {
            queue: vec![track("first").into(), track("second").into()],
            current_index: 99,
            ..PlaybackState::default()
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &state).unwrap();

        let restored = get_playback_state_from(&crate::storage::lock_storage().unwrap(), &path)
            .unwrap()
            .unwrap();
        assert_eq!(restored.current_index, 1);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn empty_queue_removes_playback_state_file() {
        let path = test_path();
        write_json_atomic(
            &crate::storage::lock_storage().unwrap(),
            &path,
            &PlaybackState {
                queue: vec![track("saved").into()],
                ..PlaybackState::default()
            },
        )
        .unwrap();

        save_playback_state_to(
            &crate::storage::lock_storage().unwrap(),
            &path,
            PlaybackState::default(),
        )
        .unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn playback_state_version_round_trips() {
        let state = PlaybackState {
            queue: vec![track("round trip").into()],
            current_index: 0,
            position_seconds: 42.5,
            page: Some(2),
            cid: Some(123),
            saved_at: 456,
            ..PlaybackState::default()
        };

        let json = serde_json::to_string(&state).unwrap();
        let restored: PlaybackState = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, PLAYBACK_STATE_VERSION);
        assert_eq!(restored.queue.len(), 1);
        assert_eq!(restored.position_seconds, 42.5);
        assert_eq!(restored.page, Some(2));
        assert_eq!(restored.cid, Some(123));
    }

    fn collection_state() -> PlaybackState {
        let data = super::super::entries::tests::collection();
        PlaybackState {
            version: 2,
            queue: vec![PlaybackQueueEntry {
                video: data.snapshot.items[0].clone(),
                entry_id: Some("reference-31".to_owned()),
                collection: Some(PlaybackCollection {
                    data,
                    member_index: 1,
                    remaining: vec![],
                    played_count: 1,
                    unit_charged: false,
                    charged_units: vec!["BV1rW4y1Q7o7:11".to_owned()],
                    history_track: None,
                }),
            }],
            current_index: 0,
            position_seconds: 12.5,
            page: Some(2),
            cid: Some(123),
            saved_at: 1700000000,
            traversal: Some(PlaybackTraversal {
                random_remaining: vec![],
                history: vec![PlaybackHistory {
                    index: 0,
                    cid: Some(11),
                    page_level: Some(true),
                    entry_id: "reference-31".to_owned(),
                    bvid: "BV1rW4y1Q7o7".to_owned(),
                    track: None,
                }],
                random_page_round: Some(RandomPageRound {
                    bvid: "BV1gB7m6eEHm".to_owned(),
                    played_count: 1,
                    remaining: vec![1, 2],
                }),
                shuffle: true,
                loop_mode: "sequence".to_owned(),
            }),
        }
    }

    #[test]
    fn collection_playback_contract_and_frozen_cursor_survive_restart() {
        let state = collection_state();
        crate::contract_tests::assert_fixture("playback-state-collection", &state);
        let path =
            test_path().with_file_name(format!("playback-roundtrip-{}.json", uuid::Uuid::new_v4()));
        let guard = crate::storage::lock_storage().unwrap();
        save_playback_state_to(&guard, &path, state.clone()).unwrap();
        let restored = get_playback_state_from(&guard, &path).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(restored).unwrap(),
            serde_json::to_value(state).unwrap()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn playback_v1_read_does_not_write_and_video_only_demand_write_keeps_old_format() {
        let path = test_path();
        let bytes = include_bytes!("../../../tests/fixtures/contract/playback-state-some.json");
        fs::write(&path, bytes).unwrap();
        let guard = crate::storage::lock_storage().unwrap();
        let mut state = get_playback_state_from(&guard, &path).unwrap().unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        state.version = 2;
        state.queue[0].entry_id = Some("video:bv1234567890".to_owned());
        save_playback_state_to(&guard, &path, state).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["version"], 1);
        assert!(value["queue"][0].get("entryId").is_none());
        assert!(value.get("traversal").is_none());
        assert!(!path.with_extension("v1.bak.json").exists());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn first_collection_playback_write_backs_up_v1_once_and_failed_backup_keeps_original() {
        let directory =
            std::env::temp_dir().join(format!("bili-playback-upgrade-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("playback-state.json");
        let backup = path.with_extension("v1.bak.json");
        let bytes = include_bytes!("../../../tests/fixtures/contract/playback-state-some.json");
        fs::write(&path, bytes).unwrap();
        let guard = crate::storage::lock_storage().unwrap();
        save_playback_state_to(&guard, &path, collection_state()).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        let mut changed = collection_state();
        changed.position_seconds = 42.0;
        save_playback_state_to(&guard, &path, changed).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        fs::write(&path, bytes).unwrap();
        fs::remove_file(&backup).unwrap();
        fs::create_dir(&backup).unwrap();
        assert!(save_playback_state_to(&guard, &path, collection_state())
            .unwrap_err()
            .contains("自动备份"));
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::remove_dir(&backup).unwrap();
        fs::write(&backup, b"{truncated").unwrap();
        assert!(save_playback_state_to(&guard, &path, collection_state())
            .unwrap_err()
            .contains("备份无效"));
        assert_eq!(fs::read(&path).unwrap(), bytes);
        fs::write(&backup, bytes).unwrap();
        save_playback_state_to(&guard, &path, collection_state()).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), bytes);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn collection_playback_import_rejects_incomplete_snapshot_cursor_and_history_identity() {
        let original = serde_json::to_value(collection_state()).unwrap();
        let cases = [
            ("/queue/0/collection/data/videoCount", serde_json::json!(3)),
            ("/queue/0/collection/memberIndex", serde_json::json!(2)),
            ("/queue/0/collection/remaining", serde_json::json!([1])),
            (
                "/traversal/history/0/entryId",
                serde_json::json!("removed-entry"),
            ),
            (
                "/traversal/history/0/bvid",
                serde_json::json!("BV1234567890"),
            ),
            ("/traversal/randomRemaining", serde_json::json!([99])),
        ];
        for (pointer, replacement) in cases {
            let mut broken = original.clone();
            *broken.pointer_mut(pointer).unwrap() = replacement;
            assert!(
                validate_import_json("playback-state.json", &serde_json::to_vec(&broken).unwrap())
                    .is_err(),
                "{pointer}"
            );
        }
        assert!(validate_import_json(
            "playback-state.json",
            &serde_json::to_vec(&original).unwrap()
        )
        .is_ok());
    }
}
