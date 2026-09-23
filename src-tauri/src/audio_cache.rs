use crate::library::{library_root, read_json_or_default, write_json_atomic, Versioned};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

const VERSION: u32 = 1;
const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const CAPACITY_OPTIONS: [u64; 5] = [
    512 * 1024 * 1024,
    1024 * 1024 * 1024,
    DEFAULT_MAX_BYTES,
    5 * 1024 * 1024 * 1024,
    10 * 1024 * 1024 * 1024,
];
const INDEX_FILE: &str = "index.json";
const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);
static AUDIO_CACHE_INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheMetadata {
    pub(crate) title: String,
    pub(crate) uploader: String,
    pub(crate) thumbnail_url: String,
    pub(crate) duration_seconds: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheItem {
    pub(crate) key: String,
    pub(crate) file_name: String,
    pub(crate) bytes: u64,
    pub(crate) last_access_at: u128,
    #[serde(flatten)]
    pub(crate) metadata: AudioCacheMetadata,
}

pub(crate) struct CachedAudio {
    pub(crate) key: String,
    pub(crate) path: PathBuf,
    pub(crate) metadata: AudioCacheMetadata,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheIndex {
    pub(crate) version: u32,
    pub(crate) max_bytes: u64,
    pub(crate) enabled: bool,
    pub(crate) items: Vec<AudioCacheItem>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheSettings {
    enabled: bool,
    max_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioCacheUsage {
    bytes: u64,
    items: usize,
}

impl Default for AudioCacheIndex {
    fn default() -> Self {
        Self {
            version: VERSION,
            max_bytes: DEFAULT_MAX_BYTES,
            enabled: false,
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
    metadata: AudioCacheMetadata,
) {
    index.items.retain(|item| item.key != key);
    index.items.push(AudioCacheItem {
        key: key.to_owned(),
        file_name: file_name.to_owned(),
        bytes,
        last_access_at,
        metadata,
    });
}

pub(crate) fn should_cache_length(content_length: Option<u64>, max_bytes: u64) -> bool {
    content_length.is_none_or(|bytes| bytes <= max_bytes / 4)
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

pub(crate) fn lookup_cached_file(
    bvid: &str,
    cid: Option<u64>,
) -> Result<Option<CachedAudio>, String> {
    if cid.is_none() {
        return Ok(None);
    }
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    lookup_cached_file_at(&cache_dir()?, bvid, cid)
}

fn lookup_cached_file_at(
    dir: &Path,
    bvid: &str,
    cid: Option<u64>,
) -> Result<Option<CachedAudio>, String> {
    let Some(key) = cache_key(bvid, cid) else {
        return Ok(None);
    };
    let path = dir.join(INDEX_FILE);
    let mut index = read_index_at(&path)?;
    if !index.enabled {
        return Ok(None);
    }
    let Some(item) = index.items.iter().find(|item| item.key == key).cloned() else {
        return Ok(None);
    };
    validate_cache_file_name(&item.file_name)?;
    let file_path = dir.join(&item.file_name);
    if file_path.is_file() {
        lookup_file_name(&mut index, &key, now_millis());
        write_index_at(&path, &index)?;
        return Ok(Some(CachedAudio {
            key,
            path: file_path,
            metadata: item.metadata,
        }));
    }

    index.items.retain(|item| item.key != key);
    write_index_at(&path, &index)?;
    Ok(None)
}

pub(crate) fn save_item(
    key: &str,
    file_name: &str,
    bytes: u64,
    metadata: AudioCacheMetadata,
) -> Result<(), String> {
    validate_cache_file_name(file_name)?;
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let path = cache_dir()?.join(INDEX_FILE);
    let mut index = read_index_at(&path)?;
    record_item(&mut index, key, file_name, bytes, now_millis(), metadata);
    write_index_at(&path, &index)
}

fn finish_download_at(
    dir: &Path,
    part_path: &Path,
    key: &str,
    metadata: AudioCacheMetadata,
    bytes: u64,
) -> Result<(), String> {
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let index_path = dir.join(INDEX_FILE);
    let mut index = read_index_at(&index_path)?;
    let file_name = cache_file_name(key);
    let final_path = dir.join(&file_name);
    if final_path.exists() {
        fs::remove_file(&final_path)
            .map_err(|error| format!("无法替换音频缓存文件 {}：{error}", final_path.display()))?;
    }
    fs::rename(part_path, &final_path)
        .map_err(|error| format!("无法保存音频缓存文件 {}：{error}", final_path.display()))?;
    record_item(&mut index, key, &file_name, bytes, now_millis(), metadata);
    write_index_at(&index_path, &index)?;
    evict_excess_at(dir, &mut index)?;
    write_index_at(&index_path, &index)
}

fn evict_excess_at(dir: &Path, index: &mut AudioCacheIndex) -> Result<(), String> {
    let candidates = eviction_candidates(index);
    delete_items_at(dir, index, candidates)
}

fn delete_items_at(
    dir: &Path,
    index: &mut AudioCacheIndex,
    items: Vec<AudioCacheItem>,
) -> Result<(), String> {
    for item in items {
        let path = dir.join(&item.file_name);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法删除音频缓存文件 {}：{error}", path.display())),
        }
        index.items.retain(|saved| saved.key != item.key);
    }
    Ok(())
}

fn remove_part_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "无法删除音频缓存临时文件 {}：{error}",
            path.display()
        )),
    }
}

#[derive(Debug, Eq, PartialEq)]
enum CachePreflight {
    Disabled,
    AlreadyCached,
    Download { max_bytes: u64 },
}

fn cache_status(key: &str) -> Result<CachePreflight, String> {
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    let dir = cache_dir()?;
    cache_status_at(&dir, key)
}

fn cache_status_at(dir: &Path, key: &str) -> Result<CachePreflight, String> {
    let index = read_index_at(&dir.join(INDEX_FILE))?;
    if !index.enabled {
        return Ok(CachePreflight::Disabled);
    }
    if index
        .items
        .iter()
        .any(|item| item.key == key && dir.join(&item.file_name).is_file())
    {
        return Ok(CachePreflight::AlreadyCached);
    }
    Ok(CachePreflight::Download {
        max_bytes: index.max_bytes,
    })
}

fn settings_at(dir: &Path) -> Result<AudioCacheSettings, String> {
    let index = read_index_at(&dir.join(INDEX_FILE))?;
    Ok(AudioCacheSettings {
        enabled: index.enabled,
        max_bytes: index.max_bytes,
    })
}

fn set_settings_at(
    dir: &Path,
    enabled: bool,
    max_bytes: u64,
) -> Result<AudioCacheSettings, String> {
    if !CAPACITY_OPTIONS.contains(&max_bytes) {
        return Err("无效的音频缓存容量上限。".to_owned());
    }
    let path = dir.join(INDEX_FILE);
    let mut index = read_index_at(&path)?;
    let needs_eviction = enabled && (!index.enabled || index.max_bytes != max_bytes);
    index.enabled = enabled;
    index.max_bytes = max_bytes;
    if needs_eviction {
        let oversized = index
            .items
            .iter()
            .filter(|item| item.bytes > max_bytes / 4)
            .cloned()
            .collect();
        delete_items_at(dir, &mut index, oversized)?;
        evict_excess_at(dir, &mut index)?;
    }
    write_index_at(&path, &index)?;
    settings_at(dir)
}

fn usage_at(dir: &Path) -> Result<AudioCacheUsage, String> {
    let mut usage = AudioCacheUsage { bytes: 0, items: 0 };
    for entry in fs::read_dir(dir)
        .map_err(|error| format!("无法读取音频缓存目录 {}：{error}", dir.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取音频缓存目录项：{error}"))?;
        let path = entry.path();
        let is_audio = match path.extension().and_then(|extension| extension.to_str()) {
            Some("m4a") => true,
            Some("part") => false,
            _ => continue,
        };
        let metadata = entry
            .metadata()
            .map_err(|error| format!("无法读取音频缓存文件 {}：{error}", path.display()))?;
        if !metadata.is_file() {
            continue;
        }
        usage.bytes = usage.bytes.saturating_add(metadata.len());
        if is_audio {
            usage.items += 1;
        }
    }
    Ok(usage)
}

#[tauri::command]
pub(crate) fn get_audio_cache_settings() -> Result<AudioCacheSettings, String> {
    let _lock = AUDIO_CACHE_INDEX_LOCK
        .lock()
        .map_err(|_| "音频缓存索引锁异常。")?;
    settings_at(&cache_dir()?)
}

#[tauri::command]
pub(crate) async fn set_audio_cache_settings(
    enabled: bool,
    max_bytes: u64,
) -> Result<AudioCacheSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = AUDIO_CACHE_INDEX_LOCK
            .lock()
            .map_err(|_| "音频缓存索引锁异常。")?;
        set_settings_at(&cache_dir()?, enabled, max_bytes)
    })
    .await
    .map_err(|error| format!("保存音频缓存设置失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_audio_cache_usage() -> Result<AudioCacheUsage, String> {
    tauri::async_runtime::spawn_blocking(|| usage_at(&cache_dir()?))
        .await
        .map_err(|error| format!("统计音频缓存占用失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn clear_audio_cache(state: tauri::State<'_, AppState>) -> Result<u32, String> {
    if state
        .cache_busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("正在缓存音频，请稍后重试清空。".to_owned());
    }
    let busy = Arc::clone(&state.cache_busy);
    tauri::async_runtime::spawn_blocking(move || {
        let _slot = CacheSlot(busy);
        clear_cache()
    })
    .await
    .map_err(|error| format!("清空音频缓存失败：{error}"))?
}

// 复刻 loudness.rs::proxy_token 的校验；该函数私有，不能修改其可见性。
fn proxy_token<'a>(audio_url: &'a str, proxy_base_url: &str) -> Result<&'a str, String> {
    audio_url
        .strip_prefix(&format!("{proxy_base_url}/audio/"))
        .filter(|token| token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "只接受当前应用的本地音频代理 URL。".to_owned())
}

struct CacheSlot(Arc<AtomicBool>);

impl Drop for CacheSlot {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub(crate) async fn cache_track_audio(
    state: tauri::State<'_, AppState>,
    audio_url: String,
    bvid: String,
    cid: Option<u64>,
    title: String,
    uploader: String,
    thumbnail_url: String,
    duration_seconds: u64,
) -> Result<String, String> {
    let Some(key) = cache_key(&bvid, cid) else {
        return Ok("no_cid".to_owned());
    };
    let max_bytes = match cache_status(&key)? {
        CachePreflight::Disabled => return Ok("disabled".to_owned()),
        CachePreflight::AlreadyCached => return Ok("already_cached".to_owned()),
        CachePreflight::Download { max_bytes } => max_bytes,
    };
    if state
        .cache_busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok("busy".to_owned());
    }
    let _slot = CacheSlot(Arc::clone(&state.cache_busy));
    let dir = cache_dir()?;
    let part_path = dir.join(format!("{}.part", cache_file_name(&key)));
    remove_part_file(&part_path)?;
    let token = proxy_token(&audio_url, &state.proxy_base_url)?;
    #[cfg(debug_assertions)]
    eprintln!("[audio-cache] start token={token} key={key}");
    #[cfg(not(debug_assertions))]
    let _ = token;

    let result = tokio::time::timeout(DOWNLOAD_TIMEOUT, async {
        let response = state
            .proxy
            .client
            .get(&audio_url)
            .send()
            .await
            .map_err(|error| format!("音频缓存请求失败：{error}"))?;
        if matches!(response.status().as_u16(), 404 | 410) {
            return Ok("skipped".to_owned());
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err(format!("音频缓存代理返回 HTTP {}", response.status()));
        }
        let content_length = response.content_length();
        if !should_cache_length(content_length, max_bytes) {
            return Ok("too_large".to_owned());
        }
        let mut file = tokio::fs::File::create(&part_path).await.map_err(|error| {
            format!("无法创建音频缓存临时文件 {}：{error}", part_path.display())
        })?;
        let mut response = response;
        let mut bytes = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("音频缓存读取失败：{error}"))?
        {
            bytes = bytes.saturating_add(chunk.len() as u64);
            if bytes > max_bytes / 4 {
                return Ok("too_large".to_owned());
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("音频缓存写入失败：{error}"))?;
        }
        file.sync_all()
            .await
            .map_err(|error| format!("音频缓存同步失败：{error}"))?;
        drop(file);
        if content_length.is_some_and(|length| length != bytes) {
            return Err("音频缓存下载字节数与 Content-Length 不一致。".to_owned());
        }
        finish_download_at(
            &dir,
            &part_path,
            &key,
            AudioCacheMetadata {
                title,
                uploader,
                thumbnail_url,
                duration_seconds,
            },
            bytes,
        )?;
        Ok("cached".to_owned())
    })
    .await
    .unwrap_or_else(|_| Ok("skipped".to_owned()));
    let cleanup = remove_part_file(&part_path);
    #[cfg(debug_assertions)]
    eprintln!("[audio-cache] key={key} result={result:?}");
    cleanup?;
    result
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
    clear_cache_at(&dir)
}

fn clear_cache_at(dir: &Path) -> Result<u32, String> {
    let index_path = dir.join(INDEX_FILE);
    let mut index = read_index_at(&index_path)?;
    let mut removed = 0u32;
    for entry in fs::read_dir(dir)
        .map_err(|error| format!("无法读取音频缓存目录 {}：{error}", dir.display()))?
    {
        let entry = entry.map_err(|error| format!("无法读取音频缓存目录项：{error}"))?;
        let path = entry.path();
        if path.is_file()
            && (path.extension().is_some_and(|extension| extension == "m4a")
                || path
                    .extension()
                    .is_some_and(|extension| extension == "part"))
        {
            fs::remove_file(&path)
                .map_err(|error| format!("无法删除音频缓存文件 {}：{error}", path.display()))?;
            if path.extension().is_some_and(|extension| extension == "m4a") {
                removed = removed.saturating_add(1);
            }
        }
    }
    index.items.clear();
    write_index_at(&index_path, &index)?;
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
            metadata: AudioCacheMetadata::default(),
        }
    }

    fn metadata() -> AudioCacheMetadata {
        AudioCacheMetadata {
            title: "测试标题".to_owned(),
            uploader: "测试 UP".to_owned(),
            thumbnail_url: "https://example.test/cover.jpg".to_owned(),
            duration_seconds: 123,
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
        assert!(!default.enabled);
        assert!(default.items.is_empty());

        let mut saved = default;
        record_item(&mut saved, "BV1xx411c7mD:1", "track.m4a", 42, 7, metadata());
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
    fn cached_audio_hit_returns_path_and_updates_access() {
        let temp = TempDir::new();
        let key = "BV1xx411c7mD:42";
        let file_name = cache_file_name(key);
        let file_path = temp.path().join(&file_name);
        fs::write(&file_path, b"audio").unwrap();
        let mut saved = item(key, 5, 1);
        saved.metadata = metadata();
        let index = AudioCacheIndex {
            enabled: true,
            items: vec![saved],
            ..AudioCacheIndex::default()
        };
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        let hit = lookup_cached_file_at(temp.path(), "BV1xx411c7mD", Some(42))
            .unwrap()
            .unwrap();
        assert_eq!(hit.key, key);
        assert_eq!(hit.path, file_path);
        assert_eq!(hit.metadata, metadata());
        let updated = read_index_at(&temp.path().join(INDEX_FILE)).unwrap();
        assert!(updated.items[0].last_access_at > 1);
    }

    #[test]
    fn cached_audio_missing_file_cleans_index_item() {
        let temp = TempDir::new();
        let key = "BV1xx411c7mD:42";
        let file_path = temp.path().join(cache_file_name(key));
        fs::write(&file_path, b"audio").unwrap();
        fs::remove_file(&file_path).unwrap();
        let index = AudioCacheIndex {
            enabled: true,
            items: vec![item(key, 5, 1)],
            ..AudioCacheIndex::default()
        };
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        assert!(lookup_cached_file_at(temp.path(), "BV1xx411c7mD", Some(42))
            .unwrap()
            .is_none());
        assert!(read_index_at(&temp.path().join(INDEX_FILE))
            .unwrap()
            .items
            .is_empty());
    }

    #[test]
    fn cached_audio_unknown_key_is_a_miss() {
        let temp = TempDir::new();
        let index = AudioCacheIndex {
            enabled: true,
            items: vec![item("other", 5, 1)],
            ..AudioCacheIndex::default()
        };
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        assert!(lookup_cached_file_at(temp.path(), "BV1xx411c7mD", Some(42))
            .unwrap()
            .is_none());
        assert_eq!(read_index_at(&temp.path().join(INDEX_FILE)).unwrap(), index);
    }

    #[test]
    fn cached_audio_disabled_is_a_miss_without_index_change() {
        let temp = TempDir::new();
        let index = AudioCacheIndex {
            items: vec![item("BV1xx411c7mD:42", 5, 1)],
            ..AudioCacheIndex::default()
        };
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        assert!(lookup_cached_file_at(temp.path(), "BV1xx411c7mD", Some(42))
            .unwrap()
            .is_none());
        assert_eq!(read_index_at(&temp.path().join(INDEX_FILE)).unwrap(), index);
    }

    #[test]
    fn cached_audio_without_cid_is_a_miss() {
        let temp = TempDir::new();
        let index = AudioCacheIndex {
            enabled: true,
            items: vec![item("BV1xx411c7mD:42", 5, 1)],
            ..AudioCacheIndex::default()
        };
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        assert!(lookup_cached_file_at(temp.path(), "BV1xx411c7mD", None)
            .unwrap()
            .is_none());
        assert_eq!(read_index_at(&temp.path().join(INDEX_FILE)).unwrap(), index);
    }

    #[test]
    fn record_inserts_and_updates_one_item() {
        let mut index = AudioCacheIndex::default();
        record_item(
            &mut index,
            "key",
            "first.m4a",
            10,
            1,
            AudioCacheMetadata::default(),
        );
        record_item(
            &mut index,
            "key",
            "second.m4a",
            20,
            2,
            AudioCacheMetadata::default(),
        );
        assert_eq!(
            index.items,
            vec![AudioCacheItem {
                key: "key".to_owned(),
                file_name: "second.m4a".to_owned(),
                bytes: 20,
                last_access_at: 2,
                metadata: AudioCacheMetadata::default(),
            }]
        );
    }

    #[test]
    fn content_length_limit() {
        assert!(should_cache_length(None, 400));
        assert!(should_cache_length(Some(99), 400));
        assert!(should_cache_length(Some(100), 400));
        assert!(!should_cache_length(Some(101), 400));
    }

    #[test]
    fn settings_persist_enabled_and_all_capacity_options() {
        let temp = TempDir::new();
        assert_eq!(
            settings_at(temp.path()).unwrap(),
            AudioCacheSettings {
                enabled: false,
                max_bytes: DEFAULT_MAX_BYTES,
            }
        );
        for max_bytes in CAPACITY_OPTIONS {
            assert_eq!(
                set_settings_at(temp.path(), true, max_bytes).unwrap(),
                AudioCacheSettings {
                    enabled: true,
                    max_bytes,
                }
            );
            assert_eq!(settings_at(temp.path()).unwrap().max_bytes, max_bytes);
        }
        assert_eq!(
            set_settings_at(temp.path(), false, DEFAULT_MAX_BYTES).unwrap(),
            AudioCacheSettings {
                enabled: false,
                max_bytes: DEFAULT_MAX_BYTES,
            }
        );
        assert_eq!(settings_at(temp.path()).unwrap().enabled, false);
    }

    #[test]
    fn invalid_capacity_does_not_change_settings() {
        let temp = TempDir::new();
        set_settings_at(temp.path(), true, DEFAULT_MAX_BYTES).unwrap();
        assert!(set_settings_at(temp.path(), false, 123).is_err());
        assert_eq!(
            settings_at(temp.path()).unwrap(),
            AudioCacheSettings {
                enabled: true,
                max_bytes: DEFAULT_MAX_BYTES,
            }
        );
    }

    #[test]
    fn disabling_cache_keeps_existing_file_and_index_item() {
        let temp = TempDir::new();
        let key = "existing";
        let file_name = cache_file_name(key);
        fs::write(temp.path().join(&file_name), b"audio").unwrap();
        let mut index = AudioCacheIndex {
            enabled: true,
            ..AudioCacheIndex::default()
        };
        record_item(&mut index, key, &file_name, 5, 1, metadata());
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        set_settings_at(temp.path(), false, DEFAULT_MAX_BYTES).unwrap();
        assert!(temp.path().join(file_name).is_file());
        let saved = read_index_at(&temp.path().join(INDEX_FILE)).unwrap();
        assert!(!saved.enabled);
        assert_eq!(saved.items.len(), 1);
    }

    #[test]
    fn lowering_capacity_removes_file_above_new_quarter_limit() {
        let temp = TempDir::new();
        let key = "existing";
        let file_name = cache_file_name(key);
        fs::write(temp.path().join(&file_name), b"audio").unwrap();
        let mut index = AudioCacheIndex {
            enabled: true,
            ..AudioCacheIndex::default()
        };
        record_item(
            &mut index,
            key,
            &file_name,
            CAPACITY_OPTIONS[0] / 2,
            1,
            metadata(),
        );
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        set_settings_at(temp.path(), true, CAPACITY_OPTIONS[0]).unwrap();
        assert!(!temp.path().join(file_name).exists());
        assert!(read_index_at(&temp.path().join(INDEX_FILE))
            .unwrap()
            .items
            .is_empty());
    }

    #[test]
    fn usage_counts_audio_and_partial_file_bytes() {
        let temp = TempDir::new();
        fs::write(temp.path().join("one.m4a"), b"audio").unwrap();
        fs::write(temp.path().join("two.m4a"), b"123").unwrap();
        fs::write(temp.path().join("incomplete.m4a.part"), b"xx").unwrap();
        fs::write(temp.path().join(INDEX_FILE), b"{}").unwrap();
        assert_eq!(
            usage_at(temp.path()).unwrap(),
            AudioCacheUsage {
                bytes: 10,
                items: 2
            }
        );
    }

    #[test]
    fn disabled_status_creates_no_audio_file() {
        let temp = TempDir::new();
        assert_eq!(
            cache_status_at(temp.path(), "BV1xx411c7mD:1").unwrap(),
            CachePreflight::Disabled
        );
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn clear_removes_files_and_items_but_keeps_settings() {
        let temp = TempDir::new();
        let key = "BV1xx411c7mD:1";
        let file_name = cache_file_name(key);
        fs::write(temp.path().join(&file_name), b"audio").unwrap();
        fs::write(temp.path().join(format!("{file_name}.part")), b"partial").unwrap();
        let mut index = AudioCacheIndex {
            enabled: true,
            max_bytes: CAPACITY_OPTIONS[0],
            ..AudioCacheIndex::default()
        };
        record_item(&mut index, key, &file_name, 5, 1, metadata());
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        assert_eq!(clear_cache_at(temp.path()).unwrap(), 1);
        assert_eq!(
            usage_at(temp.path()).unwrap(),
            AudioCacheUsage { bytes: 0, items: 0 }
        );
        let saved = read_index_at(&temp.path().join(INDEX_FILE)).unwrap();
        assert!(saved.items.is_empty());
        assert!(saved.enabled);
        assert_eq!(saved.max_bytes, CAPACITY_OPTIONS[0]);
    }

    #[test]
    fn clear_reports_corrupt_index_without_deleting_audio() {
        let temp = TempDir::new();
        let audio = temp.path().join("saved.m4a");
        fs::write(&audio, b"audio").unwrap();
        fs::write(temp.path().join(INDEX_FILE), b"invalid json").unwrap();
        assert!(clear_cache_at(temp.path()).is_err());
        assert!(audio.is_file());
    }

    #[test]
    fn finish_download_renames_and_records_metadata() {
        let temp = TempDir::new();
        let key = "BV1xx411c7mD:1";
        let file_name = cache_file_name(key);
        let part_path = temp.path().join(format!("{file_name}.part"));
        fs::write(&part_path, b"audio").unwrap();
        finish_download_at(temp.path(), &part_path, key, metadata(), 5).unwrap();
        assert!(!part_path.exists());
        assert_eq!(fs::read(temp.path().join(&file_name)).unwrap(), b"audio");
        let index = read_index_at(&temp.path().join(INDEX_FILE)).unwrap();
        assert_eq!(index.items.len(), 1);
        assert_eq!(index.items[0].key, key);
        assert_eq!(index.items[0].bytes, 5);
        assert_eq!(index.items[0].metadata, metadata());
    }

    #[test]
    fn finish_download_evicts_oldest_file() {
        let temp = TempDir::new();
        let old_key = "old";
        let old_file = cache_file_name(old_key);
        fs::write(temp.path().join(&old_file), b"old!").unwrap();
        let mut index = AudioCacheIndex {
            max_bytes: 5,
            ..AudioCacheIndex::default()
        };
        record_item(
            &mut index,
            old_key,
            &old_file,
            4,
            1,
            AudioCacheMetadata::default(),
        );
        write_index_at(&temp.path().join(INDEX_FILE), &index).unwrap();

        let new_key = "new";
        let new_file = cache_file_name(new_key);
        let part_path = temp.path().join(format!("{new_file}.part"));
        fs::write(&part_path, b"new!").unwrap();
        finish_download_at(temp.path(), &part_path, new_key, metadata(), 4).unwrap();
        assert!(!temp.path().join(old_file).exists());
        assert!(temp.path().join(new_file).is_file());
        let saved = read_index_at(&temp.path().join(INDEX_FILE)).unwrap();
        assert_eq!(saved.items.len(), 1);
        assert_eq!(saved.items[0].key, new_key);
    }

    #[test]
    fn part_files_are_removed_before_download_and_on_clear() {
        let temp = TempDir::new();
        let part_path = temp.path().join("orphan.m4a.part");
        fs::write(&part_path, b"incomplete").unwrap();
        remove_part_file(&part_path).unwrap();
        assert!(!part_path.exists());
        fs::write(&part_path, b"incomplete").unwrap();
        fs::write(temp.path().join("saved.m4a"), b"audio").unwrap();
        assert_eq!(clear_cache_at(temp.path()).unwrap(), 1);
        assert!(!part_path.exists());
        assert!(!temp.path().join("saved.m4a").exists());
    }

    #[test]
    fn proxy_url_requires_current_port_and_hex_token() {
        let base = "http://127.0.0.1:12345";
        let valid = format!("{base}/audio/0123456789abcdef0123456789abcdef");
        assert_eq!(
            proxy_token(&valid, base),
            Ok("0123456789abcdef0123456789abcdef")
        );
        assert!(proxy_token(
            "http://127.0.0.1:12346/audio/0123456789abcdef0123456789abcdef",
            base
        )
        .is_err());
        assert!(proxy_token(&format!("{base}/audio/not-a-token"), base).is_err());
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
