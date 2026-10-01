pub(crate) mod backup;
pub(crate) mod disabled_pages;
pub(crate) mod favorites;
pub(crate) mod history;
pub(crate) mod loudness_store;
pub(crate) mod playback_state;
pub(crate) mod playlists;
pub(crate) mod unavailable;

pub(crate) use favorites::list_favorites;
pub(crate) use playlists::list_playlists;

pub(crate) use history::{get_play_history, get_search_history};
pub(crate) use loudness_store::{get_track_loudness, save_track_loudness};

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            version: VERSION,
            bindings: ShortcutBindings::default(),
        }
    }
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

impl Versioned for Shortcuts {
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

fn shortcuts_path() -> Result<PathBuf, String> {
    library_file_path(SHORTCUTS_FILE)
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
    use super::test_support::test_path;
    use super::{
        normalize_bvid, normalize_playlist_name, read_json_or_default, validate_shortcut_bindings,
        write_json_atomic, ShortcutBindings, Shortcuts, VERSION,
    };
    use std::fs;

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
