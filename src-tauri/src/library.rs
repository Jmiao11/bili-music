pub(crate) mod backup;
pub(crate) mod disabled_pages;
pub(crate) mod favorites;
pub(crate) mod history;
pub(crate) mod loudness_store;
pub(crate) mod playback_state;
pub(crate) mod playlists;
pub(crate) mod shortcut_config;
pub(crate) mod unavailable;

pub(crate) use favorites::list_favorites;
pub(crate) use playlists::list_playlists;
pub(crate) use shortcut_config::get_shortcuts;

pub(crate) use history::{get_play_history, get_search_history};
pub(crate) use loudness_store::{get_track_loudness, save_track_loudness};

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const VERSION: u32 = 1;
const FAVORITES_FILE: &str = "favorites.json";
const PLAYLISTS_FILE: &str = "playlists.json";
const SEARCH_HISTORY_FILE: &str = "search-history.json";
const PLAY_HISTORY_FILE: &str = "play-history.json";
const PLAYBACK_STATE_FILE: &str = "playback-state.json";
const UNAVAILABLE_TRACKS_FILE: &str = "unavailable-tracks.json";
const DISABLED_PAGES_FILE: &str = "disabled-pages.json";
const SHORTCUTS_FILE: &str = "shortcuts.json";
const LOUDNESS_FILE: &str = "loudness.json";
#[cfg(not(debug_assertions))]
const DATA_SUBDIR: &str = "data";
#[cfg(not(debug_assertions))]
const APP_DATA_DIR: &str = "bili-music";
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

fn clean_text(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_owned()
    } else {
        value.to_owned()
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
        migrate_legacy_file_at(file_name, target, &exe_parent)?;
    }
    let _ = (file_name, target);
    Ok(())
}

#[cfg(not(debug_assertions))]
fn migrate_legacy_file_at(file_name: &str, target: &Path, exe_parent: &Path) -> Result<(), String> {
    {
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
    fn library_root_matches_expected_path_without_creating_it() {
        #[cfg(debug_assertions)]
        let expected = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".local-data");
        #[cfg(not(debug_assertions))]
        let expected = bilibili_music_core::user_data_base()
            .unwrap()
            .join("bili-music");
        let existed = expected.exists();
        assert_eq!(super::library_root().unwrap(), expected);
        assert_eq!(expected.exists(), existed);
    }

    #[test]
    fn existing_migration_target_short_circuits_without_exe_or_project_access() {
        let target = super::test_support::test_path();
        std::fs::write(&target, b"existing").unwrap();
        assert!(target.exists());
        super::migrate_legacy_file(super::FAVORITES_FILE, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"existing");
        std::fs::remove_file(target).unwrap();
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_migration_prefers_data_and_removes_empty_directory() {
        let root = super::test_support::test_path();
        let exe = root.join("exe");
        let data = exe.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join(super::FAVORITES_FILE), b"data").unwrap();
        std::fs::write(exe.join(super::FAVORITES_FILE), b"exe").unwrap();
        let target = root.join("destination").join(super::FAVORITES_FILE);
        super::migrate_legacy_file_at(super::FAVORITES_FILE, &target, &exe).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"data");
        assert_eq!(
            std::fs::read(exe.join(super::FAVORITES_FILE)).unwrap(),
            b"exe"
        );
        assert!(!data.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_migration_keeps_nonempty_directory() {
        let root = super::test_support::test_path();
        let exe = root.join("exe");
        let data = exe.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join(super::FAVORITES_FILE), b"data").unwrap();
        std::fs::write(data.join("unrelated.json"), b"keep").unwrap();
        let target = root.join("destination").join(super::FAVORITES_FILE);
        super::migrate_legacy_file_at(super::FAVORITES_FILE, &target, &exe).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"data");
        assert_eq!(std::fs::read(data.join("unrelated.json")).unwrap(), b"keep");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_migration_falls_back_to_exe_directory() {
        let root = super::test_support::test_path();
        let exe = root.join("exe");
        std::fs::create_dir_all(&exe).unwrap();
        std::fs::write(exe.join(super::FAVORITES_FILE), b"exe").unwrap();
        let target = root.join("destination").join(super::FAVORITES_FILE);
        super::migrate_legacy_file_at(super::FAVORITES_FILE, &target, &exe).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"exe");
        std::fs::remove_dir_all(root).unwrap();
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
}

#[cfg(test)]
pub(super) mod test_support {
    use super::TrackSnapshot;
    use std::path::PathBuf;
    use uuid::Uuid;

    pub(super) fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!("bili-music-playback-{}.json", Uuid::new_v4()))
    }

    pub(super) fn track(title: &str) -> TrackSnapshot {
        TrackSnapshot {
            bvid: "BV1rW4y1Q7o7".to_owned(),
            title: title.to_owned(),
            uploader: "UP".to_owned(),
            thumbnail_url: "https://example.com/cover.jpg".to_owned(),
            duration_seconds: 120,
            added_at: "1".to_owned(),
        }
    }
}
