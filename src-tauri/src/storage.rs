use crate::library::{atomic_backup_path, atomic_temp_path, Versioned};
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::fs::{self, File};
use std::io::Write;
use std::marker::PhantomData;
use std::path::Path;
use std::rc::Rc;
use std::sync::{Mutex, MutexGuard};

// ponytail: one process-wide lock; keep file I/O short and compute outside it.
static STORAGE_LOCK: Mutex<()> = Mutex::new(());
thread_local! {
    static HELD: Cell<bool> = const { Cell::new(false) };
}

pub(crate) struct StorageGuard {
    _lock: MutexGuard<'static, ()>,
    _not_send: PhantomData<Rc<()>>,
}

#[cfg(test)]
thread_local! {
    static TEST_ROOT: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) };
    static BEFORE_LOCK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
    static AFTER_READ: std::cell::RefCell<Option<Box<dyn FnMut(&Path) -> bool>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_test_root(root: std::path::PathBuf) {
    TEST_ROOT.with(|slot| *slot.borrow_mut() = Some(root));
}
#[cfg(test)]
pub(crate) fn test_root() -> Option<std::path::PathBuf> {
    TEST_ROOT.with(|slot| slot.borrow().clone())
}
#[cfg(test)]
pub(crate) fn before_lock(hook: impl FnOnce() + 'static) {
    BEFORE_LOCK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}
#[cfg(test)]
pub(crate) fn after_read(hook: impl FnMut(&Path) -> bool + 'static) {
    AFTER_READ.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
}
#[cfg(test)]
fn notify_read(path: &Path) {
    let hook = AFTER_READ.with(|slot| slot.borrow_mut().take());
    if let Some(mut hook) = hook {
        if !hook(path) {
            AFTER_READ.with(|slot| *slot.borrow_mut() = Some(hook));
        }
    }
}

pub(crate) fn lock_storage() -> Result<StorageGuard, String> {
    #[cfg(test)]
    if let Some(hook) = BEFORE_LOCK.with(|slot| slot.borrow_mut().take()) {
        hook();
    }
    if HELD.with(Cell::get) {
        return Err("存储锁不可重入。".to_owned());
    }
    let guard = STORAGE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    HELD.with(|held| held.set(true));
    Ok(StorageGuard {
        _lock: guard,
        _not_send: PhantomData,
    })
}

impl Drop for StorageGuard {
    fn drop(&mut self) {
        HELD.with(|held| held.set(false));
    }
}

pub(crate) fn read_json_or_default<T>(_: &StorageGuard, path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Default + Versioned,
{
    let value = read_json_impl(path);
    #[cfg(test)]
    notify_read(path);
    value
}

pub(crate) fn write_json_atomic<T: Serialize>(
    _: &StorageGuard,
    path: &Path,
    value: &T,
) -> Result<(), String> {
    write_json_impl(path, value)
}

// Audio-cache indices have their own lock and never acquire STORAGE_LOCK.
pub(crate) fn read_json_or_default_without_storage_lock<T>(path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Default + Versioned,
{
    read_json_impl(path)
}

pub(crate) fn write_json_atomic_without_storage_lock<T: Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), String> {
    write_json_impl(path, value)
}

pub(crate) fn read(_: &StorageGuard, path: impl AsRef<Path>) -> std::io::Result<Vec<u8>> {
    let path = path.as_ref();
    let value = fs::read(path);
    #[cfg(test)]
    notify_read(path);
    value
}
pub(crate) fn read_to_string(_: &StorageGuard, path: impl AsRef<Path>) -> std::io::Result<String> {
    fs::read_to_string(path)
}
pub(crate) fn rename(
    _: &StorageGuard,
    from: impl AsRef<Path>,
    to: impl AsRef<Path>,
) -> std::io::Result<()> {
    fs::rename(from, to)
}
pub(crate) fn copy(
    _: &StorageGuard,
    from: impl AsRef<Path>,
    to: impl AsRef<Path>,
) -> std::io::Result<u64> {
    fs::copy(from, to)
}
pub(crate) fn remove_file(_: &StorageGuard, path: impl AsRef<Path>) -> std::io::Result<()> {
    fs::remove_file(path)
}
pub(crate) fn create_file(_: &StorageGuard, path: impl AsRef<Path>) -> std::io::Result<File> {
    File::create(path)
}

enum AtomicWriteError {
    Write(std::io::Error),
    Sync(std::io::Error),
    Backup(std::io::Error),
    Save(std::io::Error),
}

impl AtomicWriteError {
    fn into_io(self) -> std::io::Error {
        match self {
            Self::Write(error) | Self::Sync(error) | Self::Backup(error) | Self::Save(error) => {
                error
            }
        }
    }
}

// JSON and raw imports share file writing and replacement. JSON retains the old
// partial-temp behavior; imports clean a failed temporary write before rollback.
fn replace_file_bytes(
    target: &Path,
    tmp: &Path,
    backup: &Path,
    chunks: &[&[u8]],
    cleanup_failed_temp: bool,
) -> Result<(), AtomicWriteError> {
    let written = (|| {
        let mut file = File::create(tmp).map_err(AtomicWriteError::Write)?;
        for chunk in chunks {
            file.write_all(chunk).map_err(AtomicWriteError::Write)?;
        }
        file.sync_all().map_err(AtomicWriteError::Sync)
    })();
    if let Err(error) = written {
        if cleanup_failed_temp {
            let _ = fs::remove_file(tmp);
        }
        return Err(error);
    }
    if target.exists() {
        if let Err(error) = fs::rename(target, backup) {
            let _ = fs::remove_file(tmp);
            return Err(AtomicWriteError::Backup(error));
        }
    }
    if let Err(error) = fs::rename(tmp, target) {
        if backup.exists() {
            let _ = fs::rename(backup, target);
        }
        let _ = fs::remove_file(tmp);
        return Err(AtomicWriteError::Save(error));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

pub(crate) fn write_bytes_atomic(
    _: &StorageGuard,
    target: &Path,
    bytes: &[u8],
) -> std::io::Result<()> {
    replace_file_bytes(
        target,
        &atomic_temp_path(target),
        &atomic_backup_path(target),
        &[bytes],
        true,
    )
    .map_err(AtomicWriteError::into_io)
}

fn read_json_impl<T>(path: &Path) -> Result<T, String>
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

fn write_json_impl<T: Serialize>(target: &Path, value: &T) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("无法确定 {} 的父目录。", target.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建资料库目录 {}：{error}", parent.display()))?;

    let tmp = atomic_temp_path(target);
    let backup = atomic_backup_path(target);
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("资料库序列化失败：{error}"))?;

    replace_file_bytes(target, &tmp, &backup, &[json.as_bytes(), b"\n"], false).map_err(|error| {
        match error {
            AtomicWriteError::Write(error) => format!("无法写入 {}：{error}", tmp.display()),
            AtomicWriteError::Sync(error) => format!("无法同步 {}：{error}", tmp.display()),
            AtomicWriteError::Backup(error) => format!(
                "无法备份旧资料库 {} 到 {}：{error}",
                target.display(),
                backup.display()
            ),
            AtomicWriteError::Save(error) => {
                format!("无法保存资料库 {}：{error}", target.display())
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::without_rust_comments;
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};

    fn rust_sources(root: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files.extend(rust_sources(&path));
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                files.push(path);
            }
        }
        files
    }

    #[test]
    fn storage_io_is_guarded_or_has_an_explicit_exception() {
        // Ratchet, not AST analysis. Test-only fixture I/O is excluded; every
        // production exception is pinned to one file and function, without globs.
        let exceptions = [
            ("audio_cache.rs", "finish_download_at"), // Audio cache has its own index lock.
            ("audio_cache.rs", "delete_items_at"),    // Audio-cache eviction.
            ("audio_cache.rs", "remove_part_file"),   // Audio-cache partial download cleanup.
            ("audio_cache.rs", "cache_track_audio"),  // Network download into cache/audio.
            ("audio_cache.rs", "clear_cache_at"),     // Clearing cache/audio.
            ("lyrics.rs", "read_lyrics_cache_inner"), // lyrics/<id>.json subdirectory.
            ("lyrics.rs", "write_lyrics_cache"),      // lyrics/<id>.json subdirectory.
            ("lyrics.rs", "clear_lyrics_cache"),      // lyrics/<id>.json subdirectory.
            ("loudness.rs", "local_audio_source"),    // Reading an audio-cache file for analysis.
            ("proxy.rs", "proxy_local_audio"), // Playback core: serving a local audio-cache file.
            ("search.rs", "read_netscape_cookies"), // External cookie file, not stored application data.
            ("library/backup.rs", "export_data_blocking"), // User-selected ZIP output, outside snapshot lock.
            ("library/backup.rs", "import_data_blocking"), // User-selected ZIP input, decompressed outside lock.
        ];
        let allowed: BTreeSet<_> = exceptions.into_iter().collect();
        let mut seen = BTreeSet::new();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for path in rust_sources(&root) {
            let relative = path
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if relative == "storage.rs" {
                continue;
            }
            let source = without_rust_comments(&fs::read_to_string(&path).unwrap());
            // Existing source files put fixture helpers/tests in a trailing cfg(test) section.
            let test_module = source
                .match_indices("#[cfg(test)]")
                .find_map(|(offset, _)| {
                    let declaration = source[offset + "#[cfg(test)]".len()..].trim_start();
                    (declaration.starts_with("mod ")
                        || declaration.starts_with("pub(crate) mod ")
                        || declaration.starts_with("pub(super) mod "))
                    .then_some(offset)
                })
                .unwrap_or(source.len());
            let production = &source[..test_module];
            let compact: String = production.chars().filter(|c| !c.is_whitespace()).collect();
            let offsets: Vec<_> = production
                .char_indices()
                .filter_map(|(offset, c)| (!c.is_whitespace()).then_some(offset))
                .collect();
            let patterns = [
                "fs::write(",
                "fs::read(",
                "fs::read_to_string(",
                "fs::rename(",
                "fs::remove_file(",
                "fs::copy(",
                "File::create(",
                "File::open(",
                "OpenOptions",
            ];
            for pattern in patterns {
                for (offset, _) in compact.match_indices(pattern) {
                    // ASCII patterns have ASCII byte offsets; translate through the compact
                    // byte prefix rather than assuming all source characters are ASCII.
                    let char_offset = compact[..offset].chars().count();
                    let prefix = &production[..offsets[char_offset]];
                    let function = prefix
                        .lines()
                        .rev()
                        .find_map(|line| {
                            let line = line.trim_start();
                            let (head, tail) = line.split_once("fn ")?;
                            if !matches!(
                                head.trim(),
                                "" | "pub"
                                    | "pub(crate)"
                                    | "pub(super)"
                                    | "async"
                                    | "pub async"
                                    | "pub(crate) async"
                                    | "pub(super) async"
                            ) {
                                return None;
                            }
                            Some(
                                tail.chars()
                                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                                    .collect::<String>(),
                            )
                        })
                        .unwrap_or_default();
                    assert!(
                        allowed.contains(&(relative.as_str(), function.as_str())),
                        "{relative}:{function} performs direct storage I/O"
                    );
                    seen.insert((relative.clone(), function));
                }
            }
        }
        let expected: BTreeSet<_> = allowed
            .into_iter()
            .map(|(file, function)| (file.to_owned(), function.to_owned()))
            .collect();
        assert_eq!(seen, expected, "review obsolete storage exceptions");
    }

    #[test]
    fn unlocked_json_entry_points_are_audio_cache_only() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for path in rust_sources(&root) {
            let relative = path.strip_prefix(&root).unwrap();
            if relative == Path::new("storage.rs") || relative == Path::new("audio_cache.rs") {
                continue;
            }
            let source = without_rust_comments(&fs::read_to_string(&path).unwrap());
            for name in [
                "read_json_or_default_without_storage_lock",
                "write_json_atomic_without_storage_lock",
            ] {
                assert!(
                    !source.contains(name),
                    "{} uses cache-only {name}",
                    relative.display()
                );
            }
        }
    }

    #[test]
    fn storage_reentry_returns_an_error_without_blocking() {
        let first = lock_storage().unwrap();
        assert!(lock_storage().is_err());
        drop(first);
        assert!(lock_storage().is_ok());
    }

    #[derive(Default, Deserialize, Serialize, PartialEq, Debug)]
    struct Fixture {
        version: u32,
        value: u32,
    }
    impl Versioned for Fixture {
        fn version(&self) -> u32 {
            self.version
        }
    }

    #[test]
    fn poisoned_storage_lock_recovers_and_can_read_and_write() {
        let failed = std::thread::spawn(|| {
            let _guard = lock_storage().unwrap();
            panic!("injected storage panic");
        });
        assert!(failed.join().is_err());
        let guard = lock_storage().unwrap();
        let path = std::env::temp_dir().join(format!("bili-storage-{}.json", uuid::Uuid::new_v4()));
        let value = Fixture {
            version: 1,
            value: 42,
        };
        write_json_atomic(&guard, &path, &value).unwrap();
        assert_eq!(
            read_json_or_default::<Fixture>(&guard, &path).unwrap(),
            value
        );
        remove_file(&guard, path).unwrap();
    }
}
