use serde::{Deserialize, Serialize};
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
const DATA_SUBDIR: &str = "data";
const APP_DATA_DIR: &str = "bili-music";
const MAX_SEARCH_HISTORY_ITEMS: usize = 100;
const MAX_PLAY_HISTORY_ITEMS: usize = 200;
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

#[derive(Debug, Deserialize, Serialize)]
struct SearchHistoryFile {
    version: u32,
    items: Vec<SearchHistoryItem>,
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

impl Default for PlayHistoryFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            items: Vec::new(),
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
    let mut file = read_favorites()?;
    let bvid = normalize_bvid(&track.bvid)?;
    if let Some(index) = file
        .items
        .iter()
        .position(|item| item.bvid.eq_ignore_ascii_case(&bvid))
    {
        file.items.remove(index);
        write_json_atomic(&favorites_path()?, &file)?;
        return Ok(FavoriteToggleResult {
            favorited: false,
            items: file.items,
        });
    }

    file.items.insert(0, snapshot_from_input(track)?);
    write_json_atomic(&favorites_path()?, &file)?;
    Ok(FavoriteToggleResult {
        favorited: true,
        items: file.items,
    })
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
    let mut file = read_playlists()?;
    let snapshot = snapshot_from_input(track)?;
    let playlist = find_playlist_mut(&mut file, &id)?;
    if !playlist
        .items
        .iter()
        .any(|item| item.bvid.eq_ignore_ascii_case(&snapshot.bvid))
    {
        playlist.items.push(snapshot);
    }
    write_json_atomic(&playlists_path()?, &file)?;
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

impl Versioned for PlayHistoryFile {
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

fn snapshot_from_input(input: TrackSnapshotInput) -> Result<TrackSnapshot, String> {
    Ok(TrackSnapshot {
        bvid: normalize_bvid(&input.bvid)?,
        title: clean_text(&input.title, "未命名视频"),
        uploader: clean_text(&input.uploader, "未知 UP 主"),
        thumbnail_url: input.thumbnail_url.trim().to_owned(),
        duration_seconds: input.duration_seconds,
        added_at: now_string(),
    })
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

fn play_history_path() -> Result<PathBuf, String> {
    library_file_path(PLAY_HISTORY_FILE)
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
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(Path::to_path_buf))
            })
            .ok_or_else(|| "无法定位用户数据目录。".to_owned())?;
        Ok(base.join(APP_DATA_DIR))
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
    use super::{normalize_bvid, normalize_playlist_name};

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
}
