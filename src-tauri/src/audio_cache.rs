#![allow(dead_code)]
// 本模块将在后续关卡接入 prepare_audio 与代理层，届时移除该属性。

use crate::library::{library_root, read_json_or_default, write_json_atomic, Versioned};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const VERSION: u32 = 1;
const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const INDEX_FILE: &str = "index.json";
static AUDIO_CACHE_INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheItem {
    pub(crate) key: String,
    pub(crate) file_name: String,
    pub(crate) bytes: u64,
    pub(crate) last_access_at: u128,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheIndex {
    pub(crate) version: u32,
    pub(crate) max_bytes: u64,
    pub(crate) enabled: bool,
    pub(crate) items: Vec<AudioCacheItem>,
}

impl Default for AudioCacheIndex {
    fn default() -> Self {
        Self {
            version: VERSION,
            max_bytes: DEFAULT_MAX_BYTES,
            enabled: true,
            items: Vec::new(),
        }
    }
}

impl Versioned for AudioCacheIndex {
    fn version(&self) -> u32 {
        self.version
    }
}

pub(crate) fn cache_dir() -> Result<PathBuf, String> {
    let dir = library_root()?.join("cache").join("audio");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("无法创建音频缓存目录 {}：{error}", dir.display()))?;
    Ok(dir)
}

pub(crate) fn cache_key(bvid: &str, cid: Option<u64>) -> Option<String> {
    cid.map(|cid| format!("{bvid}:{cid}"))
}

pub(crate) fn cache_file_name(key: &str) -> String {
    // 刻意使用哈希而非歌名，避免缓存目录变成可直接使用的音乐库。
    let digest = format!("{:x}", md5::compute(key.as_bytes()));
    format!("{}.m4a", &digest[..16])
}

pub(crate) fn lookup_file_name(
    index: &mut AudioCacheIndex,
    key: &str,
    last_access_at: u128,
) -> Option<String> {
    let item = index.items.iter_mut().find(|item| item.key == key)?;
    item.last_access_at = last_access_at;
    Some(item.file_name.clone())
}

pub(crate) fn record_item(
    index: &mut AudioCacheIndex,
    key: &str,
    file_name: &str,
    bytes: u64,
    last_access_at: u128,
) {
    index.items.retain(|item| item.key != key);
    index.items.push(AudioCacheItem {
        key: key.to_owned(),
        file_name: file_name.to_owned(),
        bytes,
        last_access_at,
    });
}

pub(crate) fn eviction_candidates(index: &AudioCacheIndex) -> Vec<AudioCacheItem> {
    let mut total = index
        .items
        .iter()
        .map(|item| u128::from(item.bytes))
        .sum::<u128>();
    let limit = u128::from(index.max_bytes);
    if total <= limit {
        return Vec::new();
    }

    let mut oldest = index.items.clone();
    oldest.sort_by(|left, right| {
        left.last_access_at
            .cmp(&right.last_access_at)
            .then_with(|| left.key.cmp(&right.key))
    });
    let mut remove = Vec::new();
    for item in oldest {
        total -= u128::from(item.bytes);
        remove.push(item);
        if total <= limit {
            break;
        }
    }
    remove
}

pub(crate) fn cache_stats(index: &AudioCacheIndex) -> (u64, usize) {
    (
        index
            .items
            .iter()
            .fold(0u64, |total, item| total.saturating_add(item.bytes)),
        index.items.len(),
    )
}

pub(crate) fn lookup_cached_file(key: &str) -> Result<Option<String>, String> {
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let dir = cache_dir()?;
    let path = dir.join(INDEX_FILE);
    let mut index = read_index_at(&path)?;
    let Some(file_name) = lookup_file_name(&mut index, key, now_millis()) else {
        return Ok(None);
    };
    if dir.join(&file_name).is_file() {
        write_index_at(&path, &index)?;
        return Ok(Some(file_name));
    }

    index.items.retain(|item| item.key != key);
    write_index_at(&path, &index)?;
    Ok(None)
}

pub(crate) fn save_item(key: &str, file_name: &str, bytes: u64) -> Result<(), String> {
    validate_cache_file_name(file_name)?;
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let path = cache_dir()?.join(INDEX_FILE);
    let mut index = read_index_at(&path)?;
    record_item(&mut index, key, file_name, bytes, now_millis());
    write_index_at(&path, &index)
}

pub(crate) fn delete_cached_file(file_name: &str) -> Result<(), String> {
    validate_cache_file_name(file_name)?;
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let dir = cache_dir()?;
    let index_path = dir.join(INDEX_FILE);
    let mut index = read_index_at(&index_path)?;
    let file_path = dir.join(file_name);
    match fs::remove_file(&file_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "无法删除音频缓存文件 {}：{error}",
                file_path.display()
            ));
        }
    }
    index.items.retain(|item| item.file_name != file_name);
    write_index_at(&index_path, &index)
}

pub(crate) fn clear_cache() -> Result<u32, String> {
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let dir = cache_dir()?;
    let mut removed = 0u32;
    for entry in fs::read_dir(&dir)
        .map_err(|error| format!("无法读取音频缓存目录 {}：{error}", dir.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取音频缓存目录项：{error}"))?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|extension| extension == "m4a") {
            fs::remove_file(&path)
                .map_err(|error| format!("无法删除音频缓存文件 {}：{error}", path.display()))?;
            removed = removed.saturating_add(1);
        }
    }
    let index_path = dir.join(INDEX_FILE);
    match fs::remove_file(&index_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "无法删除音频缓存索引 {}：{error}",
                index_path.display()
            ));
        }
    }
    Ok(removed)
}

fn read_index_at(path: &Path) -> Result<AudioCacheIndex, String> {
    read_json_or_default(path)
}

fn write_index_at(path: &Path, index: &AudioCacheIndex) -> Result<(), String> {
    write_json_atomic(path, index)
}

fn validate_cache_file_name(file_name: &str) -> Result<(), String> {
    let path = Path::new(file_name);
    if path.file_name().and_then(|name| name.to_str()) != Some(file_name)
        || path.extension().and_then(|extension| extension.to_str()) != Some("m4a")
    {
        return Err("无效的音频缓存文件名。".to_owned());
    }
    Ok(())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "bili-music-audio-cache-{}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn item(key: &str, bytes: u64, last_access_at: u128) -> AudioCacheItem {
        AudioCacheItem {
            key: key.to_owned(),
            file_name: cache_file_name(key),
            bytes,
            last_access_at,
        }
    }

    #[test]
    fn cache_key_requires_cid() {
        assert_eq!(
            cache_key("BV1xx411c7mD", Some(123)),
            Some("BV1xx411c7mD:123".to_owned())
        );
        assert_eq!(cache_key("BV1xx411c7mD", None), None);
    }

    #[test]
    fn cache_file_name_is_stable_and_distinct() {
        let first = cache_file_name("BV1xx411c7mD:1");
        assert_eq!(first, cache_file_name("BV1xx411c7mD:1"));
        assert_ne!(first, cache_file_name("BV1xx411c7mD:2"));
        assert_eq!(first.len(), 20);
        assert!(first.ends_with(".m4a"));
    }

    #[test]
    fn index_defaults_write_and_read_back() {
        let temp = TempDir::new();
        let path = temp.path().join(INDEX_FILE);
        let default = read_index_at(&path).unwrap();
        assert_eq!(default.version, VERSION);
        assert_eq!(default.max_bytes, DEFAULT_MAX_BYTES);
        assert!(default.enabled);
        assert!(default.items.is_empty());

        let mut saved = default;
        record_item(&mut saved, "BV1xx411c7mD:1", "track.m4a", 42, 7);
        write_index_at(&path, &saved).unwrap();
        assert_eq!(read_index_at(&path).unwrap(), saved);
    }

    #[test]
    fn unsupported_index_version_is_rejected() {
        let temp = TempDir::new();
        let path = temp.path().join(INDEX_FILE);
        fs::write(
            &path,
            r#"{"version":2,"maxBytes":2147483648,"enabled":true,"items":[]}"#,
        )
        .unwrap();
        let error = read_index_at(&path).unwrap_err();
        assert!(error.contains("版本 2 暂不支持"));
    }

    #[test]
    fn lookup_updates_last_access_time() {
        let mut index = AudioCacheIndex {
            items: vec![item("key", 10, 1)],
            ..AudioCacheIndex::default()
        };
        assert_eq!(
            lookup_file_name(&mut index, "key", 99),
            Some(cache_file_name("key"))
        );
        assert_eq!(index.items[0].last_access_at, 99);
        assert_eq!(lookup_file_name(&mut index, "missing", 100), None);
    }

    #[test]
    fn record_inserts_and_updates_one_item() {
        let mut index = AudioCacheIndex::default();
        record_item(&mut index, "key", "first.m4a", 10, 1);
        record_item(&mut index, "key", "second.m4a", 20, 2);
        assert_eq!(
            index.items,
            vec![AudioCacheItem {
                key: "key".to_owned(),
                file_name: "second.m4a".to_owned(),
                bytes: 20,
                last_access_at: 2,
            }]
        );
    }

    #[test]
    fn eviction_is_empty_within_limit() {
        let index = AudioCacheIndex {
            max_bytes: 20,
            items: vec![item("old", 10, 1), item("new", 10, 2)],
            ..AudioCacheIndex::default()
        };
        assert!(eviction_candidates(&index).is_empty());
    }

    #[test]
    fn eviction_selects_oldest_until_total_fits() {
        let index = AudioCacheIndex {
            max_bytes: 10,
            items: vec![
                item("new", 6, 30),
                item("oldest", 4, 10),
                item("middle", 5, 20),
            ],
            ..AudioCacheIndex::default()
        };
        let remove = eviction_candidates(&index);
        assert_eq!(
            remove
                .iter()
                .map(|item| item.key.as_str())
                .collect::<Vec<_>>(),
            vec!["oldest", "middle"]
        );
        let removed_bytes = remove.iter().map(|item| item.bytes).sum::<u64>();
        assert!(cache_stats(&index).0 - removed_bytes <= index.max_bytes);
    }

    #[test]
    fn eviction_removes_single_oversized_item() {
        let index = AudioCacheIndex {
            max_bytes: 10,
            items: vec![item("oversized", 11, 1)],
            ..AudioCacheIndex::default()
        };
        assert_eq!(
            eviction_candidates(&index)
                .iter()
                .map(|item| item.key.as_str())
                .collect::<Vec<_>>(),
            vec!["oversized"]
        );
    }

    #[test]
    fn stats_cover_empty_and_multiple_items() {
        assert_eq!(cache_stats(&AudioCacheIndex::default()), (0, 0));
        let index = AudioCacheIndex {
            items: vec![item("one", 4, 1), item("two", 7, 2)],
            ..AudioCacheIndex::default()
        };
        assert_eq!(cache_stats(&index), (11, 2));
    }
}
