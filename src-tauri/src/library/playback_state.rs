use super::{
    library_file_path, read_json_or_default, write_json_atomic, TrackSnapshot, Versioned,
    PLAYBACK_STATE_FILE,
};
use serde::{Deserialize, Serialize};
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
    get_playback_state_from(&playback_state_path()?)
}

#[tauri::command]
pub fn save_playback_state(state: PlaybackState) -> Result<(), String> {
    save_playback_state_to(&playback_state_path()?, state)
}

#[tauri::command]
pub fn clear_playback_state() -> Result<(), String> {
    clear_playback_state_at(&playback_state_path()?)
}

fn playback_state_path() -> Result<PathBuf, String> {
    library_file_path(PLAYBACK_STATE_FILE)
}

fn get_playback_state_from(path: &Path) -> Result<Option<PlaybackState>, String> {
    let mut state: PlaybackState = match read_json_or_default(path) {
        Ok(state) => state,
        Err(_) => return Ok(None),
    };
    if state.queue.is_empty() {
        return Ok(None);
    }
    state.current_index = state.current_index.min(state.queue.len() - 1);
    Ok(Some(state))
}

fn save_playback_state_to(path: &Path, mut state: PlaybackState) -> Result<(), String> {
    if state.queue.is_empty() {
        return clear_playback_state_at(path);
    }
    state.version = PLAYBACK_STATE_VERSION;
    state.queue.truncate(200);
    state.current_index = state.current_index.min(state.queue.len() - 1);
    write_json_atomic(path, &state)
}

fn clear_playback_state_at(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法删除播放状态 {}：{error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!("bili-music-playback-{}.json", Uuid::new_v4()))
    }

    fn track(title: &str) -> TrackSnapshot {
        TrackSnapshot {
            bvid: "BV1rW4y1Q7o7".to_owned(),
            title: title.to_owned(),
            uploader: "UP".to_owned(),
            thumbnail_url: "https://example.com/cover.jpg".to_owned(),
            duration_seconds: 120,
            added_at: "1".to_owned(),
        }
    }

    #[test]
    fn clamps_out_of_bounds_playback_index() {
        let path = test_path();
        let state = PlaybackState {
            queue: vec![track("first"), track("second")],
            current_index: 99,
            ..PlaybackState::default()
        };
        write_json_atomic(&path, &state).unwrap();

        let restored = get_playback_state_from(&path).unwrap().unwrap();
        assert_eq!(restored.current_index, 1);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn empty_queue_removes_playback_state_file() {
        let path = test_path();
        write_json_atomic(
            &path,
            &PlaybackState {
                queue: vec![track("saved")],
                ..PlaybackState::default()
            },
        )
        .unwrap();

        save_playback_state_to(&path, PlaybackState::default()).unwrap();
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
