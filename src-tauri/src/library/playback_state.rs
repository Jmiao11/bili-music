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
pub struct PlaybackState {
    pub version: u32,
    pub queue: Vec<TrackSnapshot>,
    pub current_index: usize,
    pub position_seconds: f64,
    pub page: Option<u32>,
    pub cid: Option<u64>,
    pub saved_at: i64,
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
        }
    }
}

impl Versioned for PlaybackState {
    fn version(&self) -> u32 {
        self.version
    }
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
    state.version = PLAYBACK_STATE_VERSION;
    state.queue.truncate(200);
    state.current_index = state.current_index.min(state.queue.len() - 1);
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
            queue: vec![track("first"), track("second")],
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
                queue: vec![track("saved")],
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
            queue: vec![track("round trip")],
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
}
