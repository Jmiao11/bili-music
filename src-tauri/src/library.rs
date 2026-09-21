use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use zip::write::SimpleFileOptions;

const VERSION: u32 = 1;
const FAVORITES_FILE: &str = "favorites.json";
const PLAYLISTS_FILE: &str = "playlists.json";
const SEARCH_HISTORY_FILE: &str = "search-history.json";
const PLAY_HISTORY_FILE: &str = "play-history.json";
const PLAYBACK_STATE_FILE: &str = "playback-state.json";
const UNAVAILABLE_TRACKS_FILE: &str = "unavailable-tracks.json";
const SHORTCUTS_FILE: &str = "shortcuts.json";
const PLAYBACK_STATE_VERSION: u32 = 1;
#[cfg(not(debug_assertions))]
const DATA_SUBDIR: &str = "data";
#[cfg(not(debug_assertions))]
const APP_DATA_DIR: &str = "bili-music";
const MAX_SEARCH_HISTORY_ITEMS: usize = 100;
const MAX_PLAY_HISTORY_ITEMS: usize = 200;
const MAX_LOUDNESS_ITEMS: usize = 2000;
const MAX_UNAVAILABLE_TRACKS: usize = 500;
// ponytail: 单文件锁串行化读写，拆分存储后再按文件细分。
static LOUDNESS_FILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static UNAVAILABLE_TRACKS_FILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[cfg(debug_assertions)]
const DEV_LIBRARY_DIR: &str = ".local-data";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSnapshot {
    pub bvid: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
    pub added_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSnapshotInput {
    pub bvid: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteToggleResult {
    pub favorited: bool,
    pub items: Vec<TrackSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub items: Vec<TrackSnapshot>,
}

#[derive(Debug, Deserialize, Serialize)]
struct FavoritesFile {
    version: u32,
    items: Vec<TrackSnapshot>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PlaylistsFile {
    version: u32,
    playlists: Vec<Playlist>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHistoryItem {
    pub keyword: String,
    pub searched_at: String,
    pub count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryItem {
    pub bvid: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail_url: String,
    pub duration_seconds: u64,
    pub last_played_at: String,
    pub count: u64,
}

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

#[derive(Debug, Deserialize, Serialize)]
struct SearchHistoryFile {
    version: u32,
    items: Vec<SearchHistoryItem>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindings {
    pub previous: Option<String>,
    pub play_pause: Option<String>,
    pub next: Option<String>,
    pub volume_up: Option<String>,
    pub volume_down: Option<String>,
}

impl ShortcutBindings {
    pub(crate) fn entries(&self) -> [(&'static str, Option<&str>); 5] {
        [
            ("previous", self.previous.as_deref()),
            ("play_pause", self.play_pause.as_deref()),
            ("next", self.next.as_deref()),
            ("volume_up", self.volume_up.as_deref()),
            ("volume_down", self.volume_down.as_deref()),
        ]
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Shortcuts {
    version: u32,
    pub bindings: ShortcutBindings,
}

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

fn get_track_loudness_at(path: &Path, key: &str) -> Result<Option<f64>, String> {
    validate_loudness_key(key)?;
    let file: LoudnessFile = read_json_or_default(path)?;
    Ok(file
        .items
        .iter()
        .find(|item| item.key == key)
        .map(|item| item.lufs))
}

#[tauri::command]
pub fn get_track_loudness(key: String) -> Result<Option<f64>, String> {
    let _lock = LOUDNESS_FILE_LOCK.lock().map_err(|_| "响度数据锁异常。")?;
    get_track_loudness_at(&library_file_path("loudness.json")?, &key)
}

fn save_track_loudness_at(
    path: &Path,
    key: &str,
    lufs: f64,
    measured_at: u128,
) -> Result<(), String> {
    validate_loudness_key(key)?;
    if !lufs.is_finite() {
        return Err("响度必须是有限数值。".to_owned());
    }
    let mut file: LoudnessFile = read_json_or_default(path)?;
    file.items.retain(|item| item.key != key);
    file.items.push(LoudnessItem {
        key: key.to_owned(),
        lufs,
        measured_at,
    });
    file.items
        .sort_by_key(|item| std::cmp::Reverse(item.measured_at));
    file.items.truncate(MAX_LOUDNESS_ITEMS);
    write_json_atomic(path, &file)
}

pub(crate) fn save_track_loudness(key: &str, lufs: f64) -> Result<(), String> {
    let _lock = LOUDNESS_FILE_LOCK.lock().map_err(|_| "响度数据锁异常。")?;
    save_track_loudness_at(
        &library_file_path("loudness.json")?,
        key,
        lufs,
        now_millis(),
    )
}

#[tauri::command]
pub fn clear_loudness_data() -> Result<(), String> {
    let _lock = LOUDNESS_FILE_LOCK.lock().map_err(|_| "响度数据锁异常。")?;
    write_json_atomic(
        &library_file_path("loudness.json")?,
        &LoudnessFile::default(),
    )
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

#[derive(Debug, Deserialize, Serialize)]
struct PlayHistoryFile {
    version: u32,
    items: Vec<PlayHistoryItem>,
}

impl Default for FavoritesFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
        }
    }
}

impl Default for PlaylistsFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            playlists: Vec::new(),
        }
    }
}

impl Default for SearchHistoryFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
        }
    }
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            version: VERSION,
            bindings: ShortcutBindings::default(),
        }
    }
}

impl Default for PlayHistoryFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
        }
    }
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

#[tauri::command]
pub fn list_favorites() -> Result<Vec<TrackSnapshot>, String> {
    Ok(read_favorites()?.items)
}

#[tauri::command]
pub fn is_favorite(bvid: String) -> Result<bool, String> {
    let bvid = normalize_bvid(&bvid)?;
    Ok(read_favorites()?
        .items
        .iter()
        .any(|track| track.bvid.eq_ignore_ascii_case(&bvid)))
}

#[tauri::command]
pub fn toggle_favorite(track: TrackSnapshotInput) -> Result<FavoriteToggleResult, String> {
    toggle_favorite_at(&favorites_path()?, track)
}

fn toggle_favorite_at(
    path: &Path,
    track: TrackSnapshotInput,
) -> Result<FavoriteToggleResult, String> {
    let mut file: FavoritesFile = read_json_or_default(path)?;
    let bvid = normalize_bvid(&track.bvid)?;
    if let Some(index) = file
        .items
        .iter()
        .position(|item| item.bvid.eq_ignore_ascii_case(&bvid))
    {
        file.items.remove(index);
        write_json_atomic(path, &file)?;
        return Ok(FavoriteToggleResult {
            favorited: false,
            items: file.items,
        });
    }

    file.items.insert(0, snapshot_from_input(track)?);
    write_json_atomic(path, &file)?;
    Ok(FavoriteToggleResult {
        favorited: true,
        items: file.items,
    })
}

#[tauri::command]
pub fn reorder_favorite(from_index: usize, to_index: usize) -> Result<Vec<TrackSnapshot>, String> {
    reorder_favorite_at(&favorites_path()?, from_index, to_index)
}

fn reorder_favorite_at(
    path: &Path,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<TrackSnapshot>, String> {
    let mut file: FavoritesFile = read_json_or_default(path)?;
    if from_index >= file.items.len() || to_index >= file.items.len() {
        return Err("收藏歌曲下标越界。".to_owned());
    }
    if from_index == to_index {
        return Ok(file.items);
    }
    let item = file.items.remove(from_index);
    file.items.insert(to_index, item);
    write_json_atomic(path, &file)?;
    Ok(file.items)
}

#[tauri::command]
pub fn reorder_playlist(from_index: usize, to_index: usize) -> Result<Vec<Playlist>, String> {
    reorder_playlist_at(&playlists_path()?, from_index, to_index)
}

fn reorder_playlist_at(
    path: &Path,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<Playlist>, String> {
    let mut file: PlaylistsFile = read_json_or_default(path)?;
    if from_index >= file.playlists.len() || to_index >= file.playlists.len() {
        return Err("歌单下标越界。".to_owned());
    }
    if from_index == to_index {
        return Ok(file.playlists);
    }
    let playlist = file.playlists.remove(from_index);
    file.playlists.insert(to_index, playlist);
    write_json_atomic(path, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn list_playlists() -> Result<Vec<Playlist>, String> {
    Ok(read_playlists()?.playlists)
}

#[tauri::command]
pub fn create_playlist(name: String) -> Result<Vec<Playlist>, String> {
    let mut file = read_playlists()?;
    let name = normalize_playlist_name(&name)?;
    let now = now_string();
    file.playlists.push(Playlist {
        id: format!("{}-{}", now_millis(), Uuid::new_v4().simple()),
        name,
        created_at: now,
        items: Vec::new(),
    });
    write_json_atomic(&playlists_path()?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn rename_playlist(id: String, name: String) -> Result<Vec<Playlist>, String> {
    let mut file = read_playlists()?;
    let name = normalize_playlist_name(&name)?;
    let playlist = find_playlist_mut(&mut file, &id)?;
    playlist.name = name;
    write_json_atomic(&playlists_path()?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn delete_playlist(id: String) -> Result<Vec<Playlist>, String> {
    let mut file = read_playlists()?;
    let original_len = file.playlists.len();
    file.playlists.retain(|playlist| playlist.id != id);
    if file.playlists.len() == original_len {
        return Err("歌单不存在。".to_owned());
    }
    write_json_atomic(&playlists_path()?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn add_to_playlist(id: String, track: TrackSnapshotInput) -> Result<Vec<Playlist>, String> {
    add_to_playlist_at(&playlists_path()?, id, track)
}

fn add_to_playlist_at(
    path: &Path,
    id: String,
    track: TrackSnapshotInput,
) -> Result<Vec<Playlist>, String> {
    let mut file = read_json_or_default(path)?;
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
    write_json_atomic(path, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn remove_from_playlist(id: String, bvid: String) -> Result<Vec<Playlist>, String> {
    let mut file = read_playlists()?;
    let bvid = normalize_bvid(&bvid)?;
    let playlist = find_playlist_mut(&mut file, &id)?;
    let original_len = playlist.items.len();
    playlist
        .items
        .retain(|item| !item.bvid.eq_ignore_ascii_case(&bvid));
    if playlist.items.len() == original_len {
        return Err("歌曲不在这个歌单中。".to_owned());
    }
    write_json_atomic(&playlists_path()?, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn reorder_playlist_item(
    id: String,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<Playlist>, String> {
    reorder_playlist_item_at(&playlists_path()?, &id, from_index, to_index)
}

fn reorder_playlist_item_at(
    path: &Path,
    id: &str,
    from_index: usize,
    to_index: usize,
) -> Result<Vec<Playlist>, String> {
    let mut file: PlaylistsFile = read_json_or_default(path)?;
    let playlist = find_playlist_mut(&mut file, id)?;
    if from_index >= playlist.items.len() || to_index >= playlist.items.len() {
        return Err("歌单歌曲下标越界。".to_owned());
    }
    if from_index == to_index {
        return Ok(file.playlists);
    }
    let item = playlist.items.remove(from_index);
    playlist.items.insert(to_index, item);
    write_json_atomic(path, &file)?;
    Ok(file.playlists)
}

#[tauri::command]
pub fn record_search_history(keyword: String) -> Result<(), String> {
    let keyword = normalize_search_keyword(&keyword)?;
    let mut file = read_search_history()?;
    let key = keyword.to_lowercase();

    if let Some(index) = file
        .items
        .iter()
        .position(|item| item.keyword.to_lowercase() == key)
    {
        let mut item = file.items.remove(index);
        item.keyword = keyword;
        item.searched_at = now_string();
        item.count = item.count.saturating_add(1);
        file.items.insert(0, item);
    } else {
        file.items.insert(
            0,
            SearchHistoryItem {
                keyword,
                searched_at: now_string(),
                count: 1,
            },
        );
    }

    if file.items.len() > MAX_SEARCH_HISTORY_ITEMS {
        file.items.truncate(MAX_SEARCH_HISTORY_ITEMS);
    }
    write_json_atomic(&search_history_path()?, &file)
}

#[tauri::command]
pub fn get_search_history() -> Result<Vec<SearchHistoryItem>, String> {
    Ok(read_search_history()?.items)
}

#[tauri::command]
pub fn clear_search_history() -> Result<(), String> {
    write_json_atomic(&search_history_path()?, &SearchHistoryFile::default())
}

#[tauri::command]
pub fn get_shortcuts() -> Result<Shortcuts, String> {
    let shortcuts: Shortcuts = read_json_or_default(&shortcuts_path()?)?;
    validate_shortcut_bindings(&shortcuts.bindings)?;
    Ok(shortcuts)
}

#[tauri::command]
pub fn set_shortcuts(app: tauri::AppHandle, bindings: ShortcutBindings) -> Result<(), String> {
    validate_shortcut_bindings(&bindings)?;
    write_json_atomic(
        &shortcuts_path()?,
        &Shortcuts {
            version: VERSION,
            bindings,
        },
    )?;
    crate::shortcuts::reload(&app);
    Ok(())
}

#[tauri::command]
pub fn record_play(track: TrackSnapshotInput) -> Result<(), String> {
    let mut file = read_play_history()?;
    let bvid = normalize_bvid(&track.bvid)?;
    let now = now_string();

    if let Some(index) = file
        .items
        .iter()
        .position(|item| item.bvid.eq_ignore_ascii_case(&bvid))
    {
        let mut item = file.items.remove(index);
        item.bvid = bvid;
        item.title = clean_text(&track.title, "Untitled video");
        item.uploader = clean_text(&track.uploader, "Unknown UP");
        item.thumbnail_url = track.thumbnail_url.trim().to_owned();
        item.duration_seconds = track.duration_seconds;
        item.last_played_at = now;
        item.count = item.count.saturating_add(1);
        file.items.insert(0, item);
    } else {
        file.items.insert(
            0,
            PlayHistoryItem {
                bvid,
                title: clean_text(&track.title, "Untitled video"),
                uploader: clean_text(&track.uploader, "Unknown UP"),
                thumbnail_url: track.thumbnail_url.trim().to_owned(),
                duration_seconds: track.duration_seconds,
                last_played_at: now,
                count: 1,
            },
        );
    }

    if file.items.len() > MAX_PLAY_HISTORY_ITEMS {
        file.items.truncate(MAX_PLAY_HISTORY_ITEMS);
    }
    write_json_atomic(&play_history_path()?, &file)
}

#[tauri::command]
pub fn get_play_history() -> Result<Vec<PlayHistoryItem>, String> {
    Ok(read_play_history()?.items)
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

#[tauri::command]
pub async fn export_data() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(export_data_blocking)
        .await
        .map_err(|error| format!("数据导出任务失败：{error}"))?
}

#[tauri::command]
pub async fn import_data() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(import_data_blocking)
        .await
        .map_err(|error| format!("数据导入任务失败：{error}"))?
}

fn export_data_blocking() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name("bili-music-backup.zip")
        .add_filter("Zip", &["zip"])
        .save_file()
    else {
        return Ok(None);
    };

    let root = library_root()?;
    let file = File::create(&path)
        .map_err(|error| format!("无法创建备份文件 {}：{error}", path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    if root.exists() {
        for entry in fs::read_dir(&root)
            .map_err(|error| format!("无法读取数据目录 {}：{error}", root.display()))?
        {
            let path = entry
                .map_err(|error| format!("无法读取数据目录项：{error}"))?
                .path();
            if !path.is_file() {
                continue;
            }
            let Some(file_name) = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
            else {
                continue;
            };
            if file_name.contains(".tmp") || file_name.ends_with(".backup") {
                continue;
            }
            zip.start_file(&file_name, options)
                .map_err(|error| format!("无法写入备份条目 {file_name}：{error}"))?;
            let mut input = File::open(&path)
                .map_err(|error| format!("无法读取数据文件 {}：{error}", path.display()))?;
            std::io::copy(&mut input, &mut zip)
                .map_err(|error| format!("无法写入备份条目 {file_name}：{error}"))?;
        }
    }

    zip.finish()
        .map_err(|error| format!("无法完成备份文件 {}：{error}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn import_data_blocking() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Zip", &["zip"])
        .pick_file()
    else {
        return Ok(None);
    };

    let root = library_root()?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建数据目录 {}：{error}", root.display()))?;
    let file = File::open(&path)
        .map_err(|error| format!("无法打开备份文件 {}：{error}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("备份文件不是有效 zip {}：{error}", path.display()))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取备份条目 #{index}：{error}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(file_name) = Path::new(entry.name())
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
        else {
            continue;
        };
        let target = root.join(&file_name);
        let mut output = File::create(&target)
            .map_err(|error| format!("无法写入数据文件 {}：{error}", target.display()))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("无法解压备份条目 {file_name}：{error}"))?;
    }

    Ok(Some("导入完成".to_owned()))
}

fn read_favorites() -> Result<FavoritesFile, String> {
    read_json_or_default(&favorites_path()?)
}

fn read_playlists() -> Result<PlaylistsFile, String> {
    read_json_or_default(&playlists_path()?)
}

fn read_search_history() -> Result<SearchHistoryFile, String> {
    read_json_or_default(&search_history_path()?)
}

fn read_play_history() -> Result<PlayHistoryFile, String> {
    read_json_or_default(&play_history_path()?)
}

pub(crate) fn read_json_or_default<T>(path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Default + Versioned,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    let parsed: T = serde_json::from_str(&contents)
        .map_err(|error| format!("{} 格式损坏：{error}", path.display()))?;
    parsed.ensure_supported_version(path)?;
    Ok(parsed)
}

pub(crate) trait Versioned {
    fn version(&self) -> u32;

    fn ensure_supported_version(&self, path: &Path) -> Result<(), String> {
        if self.version() == VERSION {
            Ok(())
        } else {
            Err(format!(
                "{} 的数据版本 {} 暂不支持。",
                path.display(),
                self.version()
            ))
        }
    }
}

impl Versioned for FavoritesFile {
    fn version(&self) -> u32 {
        self.version
    }
}

impl Versioned for PlaylistsFile {
    fn version(&self) -> u32 {
        self.version
    }
}

impl Versioned for SearchHistoryFile {
    fn version(&self) -> u32 {
        self.version
    }
}

impl Versioned for Shortcuts {
    fn version(&self) -> u32 {
        self.version
    }
}

impl Versioned for PlayHistoryFile {
    fn version(&self) -> u32 {
        self.version
    }
}

impl Versioned for PlaybackState {
    fn version(&self) -> u32 {
        self.version
    }
}

pub(crate) fn write_json_atomic<T: Serialize>(target: &Path, value: &T) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("无法确定 {} 的父目录。", target.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建资料库目录 {}：{error}", parent.display()))?;

    let tmp = target.with_extension(format!("json.tmp-{}-{}", std::process::id(), now_millis()));
    let backup = target.with_extension(format!("json.bak-{}-{}", std::process::id(), now_millis()));
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("资料库序列化失败：{error}"))?;

    {
        let mut file =
            File::create(&tmp).map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        file.write_all(json.as_bytes())
            .map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        file.write_all(b"\n")
            .map_err(|error| format!("无法写入 {}：{error}", tmp.display()))?;
        file.sync_all()
            .map_err(|error| format!("无法同步 {}：{error}", tmp.display()))?;
    }

    if target.exists() {
        fs::rename(target, &backup).map_err(|error| {
            let _ = fs::remove_file(&tmp);
            format!(
                "无法备份旧资料库 {} 到 {}：{error}",
                target.display(),
                backup.display()
            )
        })?;
    }

    if let Err(error) = fs::rename(&tmp, target) {
        if backup.exists() {
            let _ = fs::rename(&backup, target);
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!("无法保存资料库 {}：{error}", target.display()));
    }

    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

pub(crate) fn snapshot_from_input(input: TrackSnapshotInput) -> Result<TrackSnapshot, String> {
    Ok(TrackSnapshot {
        bvid: normalize_bvid(&input.bvid)?,
        title: clean_text(&input.title, "未命名视频"),
        uploader: clean_text(&input.uploader, "未知 UP 主"),
        thumbnail_url: input.thumbnail_url.trim().to_owned(),
        duration_seconds: input.duration_seconds,
        added_at: now_string(),
    })
}

// Import uses the same reader, normalization and atomic writer as add_to_playlist.
#[tauri::command]
pub fn create_imported_playlist(
    name: String,
    tracks: Vec<TrackSnapshotInput>,
) -> Result<Playlist, String> {
    create_imported_playlist_at(&playlists_path()?, name, tracks)
}

fn create_imported_playlist_at(
    path: &Path,
    name: String,
    tracks: Vec<TrackSnapshotInput>,
) -> Result<Playlist, String> {
    let mut file: PlaylistsFile = read_json_or_default(path)?;
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
    write_json_atomic(path, &file)?;
    Ok(playlist)
}

#[cfg(test)]
mod import_tests {
    use super::*;

    #[test]
    fn add_to_playlist_rejects_duplicates_without_writing() {
        let path = std::env::temp_dir().join(format!("bili-add-{}.json", Uuid::new_v4()));
        let created =
            create_imported_playlist_at(&path, "歌单".into(), vec![input("BV1rW4y1Q7o7")]).unwrap();
        let before = fs::read(&path).unwrap();
        let error = add_to_playlist_at(&path, "不存在".into(), input("BV1rW4y1Q7o7")).unwrap_err();
        assert!(error.contains("不存在"));
        let playlists =
            add_to_playlist_at(&path, created.id.clone(), input("BV1rW4y1Q7o7")).unwrap_err();
        assert!(playlists.contains("歌曲已在歌单“歌单”中"));
        // 大小写不同的 BV 号也应视为重复。
        let error =
            add_to_playlist_at(&path, created.id.clone(), input("BV1RW4Y1Q7O7")).unwrap_err();
        assert!(error.contains("歌曲已在歌单"));
        assert_eq!(fs::read(&path).unwrap(), before);
        add_to_playlist_at(&path, created.id, input("BV1cs411f7ZC")).unwrap();
        let file: PlaylistsFile = read_json_or_default(&path).unwrap();
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
        let first =
            create_imported_playlist_at(&path, "原歌单".into(), vec![input("BV1rW4y1Q7o7")])
                .unwrap();
        let created = create_imported_playlist_at(
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
        let file: PlaylistsFile = read_json_or_default(&path).unwrap();
        assert_eq!(file.version, VERSION);
        assert_eq!(file.playlists.len(), 2);
        assert_eq!(file.playlists[0].id, first.id);
        let before = fs::read(&path).unwrap();
        assert!(
            create_imported_playlist_at(&path, "新歌单".into(), vec![input("BV1rW4y1Q7o7")])
                .is_err()
        );
        assert!(create_imported_playlist_at(
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
            assert!(
                create_imported_playlist_at(&path, "歌单".into(), vec![input("BV1rW4y1Q7o7")])
                    .is_err()
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        }
        fs::remove_file(&path).unwrap();
        assert!(create_imported_playlist_at(&path, "歌单".into(), vec![]).is_err());
        assert!(create_imported_playlist_at(
            &path,
            "歌单".into(),
            (0..201).map(|_| input("BV1rW4y1Q7o7")).collect()
        )
        .is_err());
        assert!(
            create_imported_playlist_at(&path, " ".into(), vec![input("BV1rW4y1Q7o7")]).is_err()
        );
        assert!(!path.exists());
    }
}

fn normalize_bvid(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        Ok(value.to_owned())
    } else {
        Err(format!("无效的 BV 号：{value}"))
    }
}

fn normalize_playlist_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("歌单名不能为空。".to_owned());
    }
    if value.chars().count() > 40 {
        return Err("歌单名不能超过 40 个字符。".to_owned());
    }
    Ok(value.to_owned())
}

fn normalize_search_keyword(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("search keyword cannot be empty".to_owned());
    }
    if value.chars().count() > 100 {
        return Err("search keyword is too long".to_owned());
    }
    Ok(value.to_owned())
}

fn validate_shortcut_bindings(bindings: &ShortcutBindings) -> Result<(), String> {
    let mut seen = HashSet::new();
    for (action, binding) in bindings.entries() {
        let Some(binding) = binding else {
            continue;
        };
        if binding.trim().is_empty() {
            return Err(format!("{action} shortcut must be null instead of empty"));
        }
        let normalized = normalize_shortcut(binding)
            .ok_or_else(|| format!("invalid shortcut for {action}: {binding}"))?;
        if !seen.insert(normalized) {
            return Err(format!("duplicate shortcut binding: {binding}"));
        }
    }
    Ok(())
}

fn normalize_shortcut(value: &str) -> Option<String> {
    let tokens = value.split('+').map(str::trim).collect::<Vec<_>>();
    if tokens.is_empty() || tokens.len() > 5 || tokens.iter().any(|token| token.is_empty()) {
        return None;
    }

    let mut modifiers = Vec::new();
    for token in &tokens[..tokens.len() - 1] {
        let modifier = match token.to_ascii_uppercase().as_str() {
            "ALT" | "OPTION" => "ALT",
            "CONTROL" | "CTRL" => "CONTROL",
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => {
                if cfg!(target_os = "macos") {
                    "SUPER"
                } else {
                    "CONTROL"
                }
            }
            "COMMAND" | "CMD" | "SUPER" => "SUPER",
            "SHIFT" => "SHIFT",
            _ => return None,
        };
        if modifiers.contains(&modifier) {
            return None;
        }
        modifiers.push(modifier);
    }

    let key = normalize_shortcut_key(tokens[tokens.len() - 1])?;
    modifiers.sort_unstable();
    modifiers.push(&key);
    Some(modifiers.join("+"))
}

fn normalize_shortcut_key(value: &str) -> Option<String> {
    let key = value.to_ascii_uppercase();
    let key = match key.as_str() {
        key if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => key.to_owned(),
        key if key.len() == 4
            && key.starts_with("KEY")
            && key.as_bytes()[3].is_ascii_alphabetic() =>
        {
            key[3..].to_owned()
        }
        key if key.len() == 6 && key.starts_with("DIGIT") && key.as_bytes()[5].is_ascii_digit() => {
            key[5..].to_owned()
        }
        "ARROWLEFT" | "LEFT" => "LEFT".to_owned(),
        "ARROWRIGHT" | "RIGHT" => "RIGHT".to_owned(),
        "ARROWUP" | "UP" => "UP".to_owned(),
        "ARROWDOWN" | "DOWN" => "DOWN".to_owned(),
        key if key
            .strip_prefix('F')
            .and_then(|number| number.parse::<u8>().ok())
            .is_some_and(|number| (1..=24).contains(&number)) =>
        {
            key.to_owned()
        }
        "BACKQUOTE" | "BACKSLASH" | "BRACKETLEFT" | "BRACKETRIGHT" | "PAUSE" | "PAUSEBREAK"
        | "COMMA" | "EQUAL" | "MINUS" | "PERIOD" | "QUOTE" | "SEMICOLON" | "SLASH"
        | "BACKSPACE" | "CAPSLOCK" | "ENTER" | "SPACE" | "TAB" | "DELETE" | "END" | "HOME"
        | "INSERT" | "PAGEDOWN" | "PAGEUP" | "PRINTSCREEN" | "SCROLLLOCK" | "NUMLOCK"
        | "ESCAPE" | "ESC" | "AUDIOVOLUMEDOWN" | "VOLUMEDOWN" | "AUDIOVOLUMEUP" | "VOLUMEUP"
        | "AUDIOVOLUMEMUTE" | "VOLUMEMUTE" | "MEDIAPLAY" | "MEDIAPAUSE" | "MEDIAPLAYPAUSE"
        | "MEDIASTOP" | "MEDIATRACKNEXT" | "MEDIATRACKPREV" | "MEDIATRACKPREVIOUS" => key,
        key if key
            .strip_prefix("NUMPAD")
            .or_else(|| key.strip_prefix("NUM"))
            .is_some_and(|suffix| {
                matches!(
                    suffix,
                    "0" | "1"
                        | "2"
                        | "3"
                        | "4"
                        | "5"
                        | "6"
                        | "7"
                        | "8"
                        | "9"
                        | "ADD"
                        | "PLUS"
                        | "DECIMAL"
                        | "DIVIDE"
                        | "ENTER"
                        | "EQUAL"
                        | "MULTIPLY"
                        | "SUBTRACT"
                )
            }) =>
        {
            key.to_owned()
        }
        _ => return None,
    };
    Some(key)
}

fn clean_text(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_owned()
    } else {
        value.to_owned()
    }
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

fn favorites_path() -> Result<PathBuf, String> {
    library_file_path(FAVORITES_FILE)
}

fn playlists_path() -> Result<PathBuf, String> {
    library_file_path(PLAYLISTS_FILE)
}

fn search_history_path() -> Result<PathBuf, String> {
    library_file_path(SEARCH_HISTORY_FILE)
}

fn shortcuts_path() -> Result<PathBuf, String> {
    library_file_path(SHORTCUTS_FILE)
}

fn play_history_path() -> Result<PathBuf, String> {
    library_file_path(PLAY_HISTORY_FILE)
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

fn library_file_path(file_name: &str) -> Result<PathBuf, String> {
    let root = library_root()?;
    let target = root.join(file_name);
    migrate_legacy_file(file_name, &target)?;
    Ok(target)
}

pub(crate) fn library_root() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法从 CARGO_MANIFEST_DIR 定位项目根目录。".to_owned())?;
        return Ok(project_root.join(DEV_LIBRARY_DIR));
    }

    #[cfg(not(debug_assertions))]
    {
        Ok(bilibili_music_core::user_data_base()?.join(APP_DATA_DIR))
    }
}

fn migrate_legacy_file(file_name: &str, target: &Path) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        if target.exists() {
            return Ok(());
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法从 CARGO_MANIFEST_DIR 定位项目根目录。".to_owned())?;
        let legacy = project_root.join(file_name);
        if !legacy.exists() {
            return Ok(());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建资料库目录 {}：{error}", parent.display()))?;
        }
        fs::rename(&legacy, target).map_err(|error| {
            format!(
                "无法迁移旧资料库 {} 到 {}：{error}",
                legacy.display(),
                target.display()
            )
        })?;
    }
    #[cfg(not(debug_assertions))]
    {
        if target.exists() {
            return Ok(());
        }
        let exe =
            std::env::current_exe().map_err(|error| format!("无法定位当前 exe 路径：{error}"))?;
        let exe_parent = exe
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位 exe 所在目录。".to_owned())?;
        let legacy_data_dir = exe_parent.join(DATA_SUBDIR);
        let legacy = [legacy_data_dir.join(file_name), exe_parent.join(file_name)]
            .into_iter()
            .find(|path| path.exists());
        let Some(legacy) = legacy else {
            return Ok(());
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建资料库目录 {}：{error}", parent.display()))?;
        }
        fs::rename(&legacy, target).map_err(|error| {
            format!(
                "无法迁移旧资料库 {} 到 {}：{error}",
                legacy.display(),
                target.display()
            )
        })?;
        if legacy_data_dir.exists()
            && legacy_data_dir
                .read_dir()
                .map_err(|error| {
                    format!(
                        "无法读取旧资料库目录 {}：{error}",
                        legacy_data_dir.display()
                    )
                })?
                .next()
                .is_none()
        {
            fs::remove_dir(&legacy_data_dir).map_err(|error| {
                format!(
                    "无法删除空旧资料库目录 {}：{error}",
                    legacy_data_dir.display()
                )
            })?;
        }
    }
    let _ = (file_name, target);
    Ok(())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_string() -> String {
    now_millis().to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        get_playback_state_from, normalize_bvid, normalize_playlist_name, read_json_or_default,
        reorder_favorite_at, reorder_playlist_at, reorder_playlist_item_at, save_playback_state_to,
        toggle_favorite_at, validate_shortcut_bindings, write_json_atomic, FavoritesFile,
        PlaybackState, Playlist, PlaylistsFile, ShortcutBindings, Shortcuts, TrackSnapshot,
        TrackSnapshotInput, PLAYBACK_STATE_VERSION, VERSION,
    };
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!("bili-music-playback-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn shortcuts_default_to_all_unbound() {
        assert_eq!(Shortcuts::default().bindings, ShortcutBindings::default());
    }

    #[test]
    fn shortcuts_round_trip() {
        let path = test_path();
        let shortcuts = Shortcuts {
            version: VERSION,
            bindings: ShortcutBindings {
                previous: Some("Ctrl+Alt+Left".to_owned()),
                play_pause: Some("Ctrl+Alt+Space".to_owned()),
                ..Default::default()
            },
        };
        write_json_atomic(&path, &shortcuts).unwrap();
        assert_eq!(read_json_or_default::<Shortcuts>(&path).unwrap(), shortcuts);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn shortcuts_reject_unsupported_version() {
        let path = test_path();
        fs::write(&path, r#"{"version":999,"bindings":{}}"#).unwrap();
        assert!(read_json_or_default::<Shortcuts>(&path)
            .unwrap_err()
            .contains("999"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn shortcut_validation_rejects_empty_strings() {
        let bindings = ShortcutBindings {
            previous: Some("  ".to_owned()),
            ..Default::default()
        };
        assert!(validate_shortcut_bindings(&bindings).is_err());
    }

    #[test]
    fn shortcut_validation_rejects_duplicate_bindings() {
        let bindings = ShortcutBindings {
            previous: Some("Ctrl+Alt+Left".to_owned()),
            next: Some("alt+control+ArrowLeft".to_owned()),
            ..Default::default()
        };
        assert!(validate_shortcut_bindings(&bindings).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn shortcut_validation_treats_command_or_control_as_command_on_macos() {
        let bindings = ShortcutBindings {
            previous: Some("CommandOrControl+P".to_owned()),
            next: Some("Command+P".to_owned()),
            ..Default::default()
        };
        assert!(validate_shortcut_bindings(&bindings).is_err());
    }

    #[test]
    fn shortcut_validation_accepts_legal_combinations_and_nulls() {
        let bindings = ShortcutBindings {
            previous: Some("Ctrl+Alt+Left".to_owned()),
            play_pause: Some("Ctrl+Alt+Space".to_owned()),
            next: Some("Ctrl+Alt+Right".to_owned()),
            volume_up: Some("Ctrl+Alt+Up".to_owned()),
            volume_down: None,
        };
        assert_eq!(validate_shortcut_bindings(&bindings), Ok(()));
    }

    #[test]
    fn loudness_round_trip_missing_key_and_update() {
        let path = test_path();
        let key = "BV1GF4X6MEb1:1";
        assert_eq!(super::get_track_loudness_at(&path, key).unwrap(), None);
        super::save_track_loudness_at(&path, key, -10.55, 100).unwrap();
        assert_eq!(
            super::get_track_loudness_at(&path, key).unwrap(),
            Some(-10.55)
        );
        assert_eq!(
            super::get_track_loudness_at(&path, "BV1GF4X6MEb1:2").unwrap(),
            None
        );
        super::save_track_loudness_at(&path, key, -13.75, 200).unwrap();
        let file: super::LoudnessFile = read_json_or_default(&path).unwrap();
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
        write_json_atomic(&path, &file).unwrap();
        super::save_track_loudness_at(&path, "BV1GF4X6MEb1:2001", -12.0, 3000).unwrap();
        let saved: super::LoudnessFile = read_json_or_default(&path).unwrap();
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
        assert!(super::get_track_loudness_at(&path, "BV1GF4X6MEb1:1").is_err());
        assert!(super::save_track_loudness_at(&path, "BV1GF4X6MEb1:1", -10.0, 1).is_err());
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
            assert!(super::save_track_loudness_at(&path, key, -10.0, 1).is_err());
        }
        assert!(super::save_track_loudness_at(&path, "BV1GF4X6MEb1:1", f64::NAN, 1).is_err());
        assert!(!path.exists());
    }

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

    fn track_with_bvid(bvid: &str, title: &str) -> TrackSnapshot {
        TrackSnapshot {
            bvid: bvid.into(),
            ..track(title)
        }
    }

    #[test]
    fn validates_bvid_shape() {
        assert!(normalize_bvid("BV1rW4y1Q7o7").is_ok());
        assert!(normalize_bvid("av123").is_err());
    }

    #[test]
    fn validates_playlist_name() {
        assert_eq!(normalize_playlist_name("  晚风  ").unwrap(), "晚风");
        assert!(normalize_playlist_name(" ").is_err());
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
        let result = reorder_playlist_item_at(&path, "test", 0, 3).unwrap();
        let expected = [1, 2, 3, 0].map(|index| original.playlists[0].items[index].clone());
        assert_eq!(
            serde_json::to_value(&result[0].items).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&result[1]).unwrap(),
            serde_json::to_value(&original.playlists[1]).unwrap()
        );
        let persisted: PlaylistsFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_playlist_item_at(&path, "test", 3, 1).unwrap();
        let expected = [0, 3, 1, 2].map(|index| original.playlists[0].items[index].clone());
        assert_eq!(
            serde_json::to_value(&result[0].items).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: PlaylistsFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_playlist_item_at(&path, "test", 2, 2).unwrap();
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
            assert!(reorder_playlist_item_at(&path, "test", from, to).is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        assert!(reorder_playlist_item_at(&path, "empty", 0, 0).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reorder_missing_playlist_returns_error() {
        let (path, _) = reorder_fixture();
        let before = fs::read(&path).unwrap();
        assert!(reorder_playlist_item_at(&path, "missing", 0, 1).is_err());
        assert!(reorder_playlist_item_at(&path, "missing", 0, 0).is_err());
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
                let result = reorder_playlist_item_at(&path, "test", from, to).unwrap();
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
        let result = reorder_playlist_at(&path, 0, 3).unwrap();
        let expected = [1, 2, 3, 0].map(|index| &original.playlists[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: PlaylistsFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_playlist_at(&path, 3, 1).unwrap();
        let expected = [0, 3, 1, 2].map(|index| &original.playlists[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: PlaylistsFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_playlist_at(&path, 2, 2).unwrap();
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
            assert!(reorder_playlist_at(&path, from, to).is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        let empty = serde_json::to_vec(&PlaylistsFile::default()).unwrap();
        fs::write(&path, &empty).unwrap();
        assert!(reorder_playlist_at(&path, 0, 0).is_err());
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
                let result = reorder_playlist_at(&path, from, to).unwrap();
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
                reorder_playlist_at(&path, from, to).unwrap();
                let persisted: PlaylistsFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_favorite_at(&path, 0, 3).unwrap();
        let expected = [1, 2, 3, 0].map(|index| &original.items[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: FavoritesFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_favorite_at(&path, 3, 1).unwrap();
        let expected = [0, 3, 1, 2].map(|index| &original.items[index]);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        let persisted: FavoritesFile = read_json_or_default(&path).unwrap();
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
        let result = reorder_favorite_at(&path, 2, 2).unwrap();
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
            assert!(reorder_favorite_at(&path, from, to).is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
        }
        let empty = serde_json::to_vec(&FavoritesFile::default()).unwrap();
        fs::write(&path, &empty).unwrap();
        assert!(reorder_favorite_at(&path, 0, 0).is_err());
        assert_eq!(fs::read(&path).unwrap(), empty);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn favorite_order_preserves_count_and_bvids() {
        let (path, original) = favorite_fixture();
        let mut expected: Vec<_> = original.items.iter().map(|item| &item.bvid).collect();
        expected.sort();
        for from in 0..expected.len() {
            for to in 0..expected.len() {
                let result = reorder_favorite_at(&path, from, to).unwrap();
                assert_eq!(result.len(), expected.len());
                let mut actual: Vec<_> = result.iter().map(|item| &item.bvid).collect();
                actual.sort();
                assert_eq!(actual, expected);
            }
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn toggle_favorite_inserts_new_item_at_front() {
        let (path, original) = favorite_fixture();
        let result = toggle_favorite_at(&path, favorite_input("BV1i6K46HEcf")).unwrap();
        assert!(result.favorited);
        assert_eq!(result.items.len(), original.items.len() + 1);
        assert_eq!(result.items[0].bvid, "BV1i6K46HEcf");
        assert_eq!(result.items[0].title, "new favorite");
        assert!(!result.items[0].added_at.is_empty());
        assert_eq!(
            serde_json::to_value(&result.items[1..]).unwrap(),
            serde_json::to_value(original.items).unwrap()
        );
        let persisted: FavoritesFile = read_json_or_default(&path).unwrap();
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
            let result = toggle_favorite_at(&path, favorite_input(bvid)).unwrap();
            assert!(!result.favorited);
            assert_eq!(result.items.len(), original.items.len() - 1);
            assert_eq!(
                serde_json::to_value(&result.items).unwrap(),
                serde_json::to_value(&original.items[1..]).unwrap()
            );
            let persisted: FavoritesFile = read_json_or_default(&path).unwrap();
            assert_eq!(
                serde_json::to_value(persisted.items).unwrap(),
                serde_json::to_value(result.items).unwrap()
            );
            fs::remove_file(path).unwrap();
        }
    }
}
