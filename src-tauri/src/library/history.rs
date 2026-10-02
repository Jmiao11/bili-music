use super::{
    clean_text, library_file_path, normalize_bvid, now_string, read_json_or_default,
    write_json_atomic, TrackSnapshotInput, Versioned, PLAY_HISTORY_FILE, SEARCH_HISTORY_FILE,
    VERSION,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_SEARCH_HISTORY_ITEMS: usize = 100;

const MAX_PLAY_HISTORY_ITEMS: usize = 200;

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

#[tauri::command]
pub fn record_search_history(keyword: String) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    record_search_history_at(guard, || search_history_path(guard), keyword)
}

fn record_search_history_at(
    guard: &crate::storage::StorageGuard,
    path: impl Fn() -> Result<PathBuf, String>,
    keyword: String,
) -> Result<(), String> {
    let keyword = normalize_search_keyword(&keyword)?;
    let mut file = read_search_history_at(guard, &path()?)?;
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
    write_json_atomic(guard, &path()?, &file)
}
#[tauri::command]
pub fn get_search_history() -> Result<Vec<SearchHistoryItem>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    get_search_history_at(guard, || search_history_path(guard))
}

fn get_search_history_at(
    guard: &crate::storage::StorageGuard,
    path: impl Fn() -> Result<PathBuf, String>,
) -> Result<Vec<SearchHistoryItem>, String> {
    Ok(read_search_history_at(guard, &path()?)?.items)
}
#[tauri::command]
pub fn clear_search_history() -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    clear_search_history_at(guard, || search_history_path(guard))
}

fn clear_search_history_at(
    guard: &crate::storage::StorageGuard,
    path: impl Fn() -> Result<PathBuf, String>,
) -> Result<(), String> {
    write_json_atomic(guard, &path()?, &SearchHistoryFile::default())
}
#[tauri::command]
pub fn record_play(track: TrackSnapshotInput) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    record_play_at(guard, || play_history_path(guard), track)
}

fn record_play_at(
    guard: &crate::storage::StorageGuard,
    path: impl Fn() -> Result<PathBuf, String>,
    track: TrackSnapshotInput,
) -> Result<(), String> {
    let mut file = read_play_history_at(guard, &path()?)?;
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
    write_json_atomic(guard, &path()?, &file)
}
#[tauri::command]
pub fn get_play_history() -> Result<Vec<PlayHistoryItem>, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    get_play_history_at(guard, || play_history_path(guard))
}

fn get_play_history_at(
    guard: &crate::storage::StorageGuard,
    path: impl Fn() -> Result<PathBuf, String>,
) -> Result<Vec<PlayHistoryItem>, String> {
    Ok(read_play_history_at(guard, &path()?)?.items)
}
fn read_search_history_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
) -> Result<SearchHistoryFile, String> {
    read_json_or_default(guard, path)
}

fn read_play_history_at(
    guard: &crate::storage::StorageGuard,
    path: &Path,
) -> Result<PlayHistoryFile, String> {
    read_json_or_default(guard, path)
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

fn search_history_path(guard: &crate::storage::StorageGuard) -> Result<PathBuf, String> {
    library_file_path(guard, SEARCH_HISTORY_FILE)
}

fn play_history_path(guard: &crate::storage::StorageGuard) -> Result<PathBuf, String> {
    library_file_path(guard, PLAY_HISTORY_FILE)
}

pub(super) fn validate_search_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<SearchHistoryFile>(file_name, bytes)
}

pub(super) fn validate_play_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<PlayHistoryFile>(file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::test_path;
    use super::*;
    use std::fs;

    fn history_input(bvid: &str) -> TrackSnapshotInput {
        TrackSnapshotInput {
            bvid: bvid.to_owned(),
            title: " title ".to_owned(),
            uploader: " uploader ".to_owned(),
            thumbnail_url: " https://example.test/cover ".to_owned(),
            duration_seconds: 123,
        }
    }

    fn history_search_item(keyword: &str, count: u64) -> super::SearchHistoryItem {
        super::SearchHistoryItem {
            keyword: keyword.to_owned(),
            searched_at: "seed".to_owned(),
            count,
        }
    }

    fn history_play_item(bvid: &str, count: u64) -> super::PlayHistoryItem {
        super::PlayHistoryItem {
            bvid: bvid.to_owned(),
            title: "old title".to_owned(),
            uploader: "old uploader".to_owned(),
            thumbnail_url: "old cover".to_owned(),
            duration_seconds: 1,
            last_played_at: "seed".to_owned(),
            count,
        }
    }

    #[test]
    fn history_search_normalizes_counts_and_orders() {
        let path = test_path();
        for keyword in [" Alpha ", "Beta", " ALPHA "] {
            super::record_search_history_at(
                &crate::storage::lock_storage().unwrap(),
                || Ok(path.clone()),
                keyword.to_owned(),
            )
            .unwrap();
        }
        let items = super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!((&*items[0].keyword, items[0].count), ("ALPHA", 2));
        assert_eq!((&*items[1].keyword, items[1].count), ("Beta", 1));
        assert!(items
            .iter()
            .all(|item| item.searched_at.parse::<u128>().is_ok()));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_search_get_preserves_order_and_record_truncates() {
        let path = test_path();
        let file = super::SearchHistoryFile {
            version: VERSION,
            items: (0..105)
                .map(|i| history_search_item(&format!("key{i}"), 1))
                .collect(),
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        let before = super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(before.len(), 105);
        assert_eq!(before[0].keyword, "key0");
        assert_eq!(before[104].keyword, "key104");
        super::record_search_history_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            "new".to_owned(),
        )
        .unwrap();
        let after = super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(after.len(), 100);
        assert_eq!(after[0].keyword, "new");
        assert_eq!(after[99].keyword, "key98");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_search_saturates_counts_but_does_not_trim_stored_keys() {
        let path = test_path();
        let mut file = super::SearchHistoryFile {
            version: VERSION,
            items: vec![history_search_item("Alpha", u64::MAX)],
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        super::record_search_history_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            "alpha".to_owned(),
        )
        .unwrap();
        assert_eq!(
            super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                path.clone()
            ))
            .unwrap()[0]
                .count,
            u64::MAX
        );
        file.items[0].keyword = " Alpha ".to_owned();
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        super::record_search_history_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            " alpha ".to_owned(),
        )
        .unwrap();
        let items = super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!((&*items[0].keyword, items[0].count), ("alpha", 1));
        assert_eq!(items[1].keyword, " Alpha ");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_search_rejects_input_before_resolving_path() {
        let calls = std::cell::Cell::new(0);
        for keyword in ["".to_owned(), " \n\t ".to_owned(), "音".repeat(101)] {
            let error = super::record_search_history_at(
                &crate::storage::lock_storage().unwrap(),
                || {
                    calls.set(calls.get() + 1);
                    Err("path failure".to_owned())
                },
                keyword,
            )
            .unwrap_err();
            assert!(error.starts_with("search keyword"));
        }
        assert_eq!(calls.get(), 0);
        assert_eq!(
            super::record_search_history_at(
                &crate::storage::lock_storage().unwrap(),
                || {
                    calls.set(calls.get() + 1);
                    Err("path failure".to_owned())
                },
                "音".repeat(100)
            )
            .unwrap_err(),
            "path failure"
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn history_search_preserves_bad_files_and_clear_replaces_them() {
        let path = test_path();
        assert!(
            super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                path.clone()
            ))
            .unwrap()
            .is_empty()
        );
        for bytes in ["{broken", r#"{"version":999,"items":[]}"#] {
            fs::write(&path, bytes).unwrap();
            assert!(
                super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                    path.clone()
                ))
                .is_err()
            );
            assert!(super::record_search_history_at(
                &crate::storage::lock_storage().unwrap(),
                || Ok(path.clone()),
                "valid".to_owned()
            )
            .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
            super::clear_search_history_at(&crate::storage::lock_storage().unwrap(), || {
                Ok(path.clone())
            })
            .unwrap();
            assert!(
                super::get_search_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                    path.clone()
                ))
                .unwrap()
                .is_empty()
            );
            let file: super::SearchHistoryFile =
                read_json_or_default(&crate::storage::lock_storage().unwrap(), &path).unwrap();
            assert_eq!(file.version, VERSION);
        }
        fs::remove_file(&path).unwrap();
        super::clear_search_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert!(path.exists());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_play_normalizes_counts_updates_and_orders() {
        let path = test_path();
        for bvid in [" BV1GF4X6MEb1 ", "BV1rW4y1Q7o7"] {
            super::record_play_at(
                &crate::storage::lock_storage().unwrap(),
                || Ok(path.clone()),
                history_input(bvid),
            )
            .unwrap();
        }
        let mut input = history_input(" BV1gf4x6meb1 ");
        input.title = " \t ".to_owned();
        input.uploader.clear();
        input.duration_seconds = 456;
        super::record_play_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            input,
        )
        .unwrap();
        let items = super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!((&*items[0].bvid, items[0].count), ("BV1gf4x6meb1", 2));
        assert_eq!(items[0].title, "Untitled video");
        assert_eq!(items[0].uploader, "Unknown UP");
        assert_eq!(items[0].thumbnail_url, "https://example.test/cover");
        assert_eq!(items[0].duration_seconds, 456);
        assert!(items[0].last_played_at.parse::<u128>().is_ok());
        assert_eq!((&*items[1].bvid, items[1].count), ("BV1rW4y1Q7o7", 1));
        assert_eq!(items[1].title, "title");
        assert_eq!(items[1].uploader, "uploader");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_play_get_preserves_order_and_record_truncates() {
        let path = test_path();
        let file = super::PlayHistoryFile {
            version: VERSION,
            items: (0..205)
                .map(|i| history_play_item(&format!("BV{i:010}"), 1))
                .collect(),
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        let before = super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(before.len(), 205);
        assert_eq!(before[0].bvid, "BV0000000000");
        assert_eq!(before[204].bvid, "BV0000000204");
        super::record_play_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            history_input("BV1GF4X6MEb1"),
        )
        .unwrap();
        let after = super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(after.len(), 200);
        assert_eq!(after[0].bvid, "BV1GF4X6MEb1");
        assert_eq!(after[199].bvid, "BV0000000198");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_play_saturates_counts_but_does_not_trim_stored_keys() {
        let path = test_path();
        let mut file = super::PlayHistoryFile {
            version: VERSION,
            items: vec![history_play_item("BV1GF4X6MEb1", u64::MAX)],
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        super::record_play_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            history_input("BV1GF4X6MEb1"),
        )
        .unwrap();
        assert_eq!(
            super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                path.clone()
            ))
            .unwrap()[0]
                .count,
            u64::MAX
        );
        file.items[0].bvid = " BV1GF4X6MEb1 ".to_owned();
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &file).unwrap();
        super::record_play_at(
            &crate::storage::lock_storage().unwrap(),
            || Ok(path.clone()),
            history_input(" BV1GF4X6MEb1 "),
        )
        .unwrap();
        let items = super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || {
            Ok(path.clone())
        })
        .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!((&*items[0].bvid, items[0].count), ("BV1GF4X6MEb1", 1));
        assert_eq!(items[1].bvid, " BV1GF4X6MEb1 ");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn history_play_reads_before_validating_and_preserves_bad_files() {
        let path = test_path();
        assert!(
            super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                path.clone()
            ))
            .unwrap()
            .is_empty()
        );
        assert_eq!(
            super::record_play_at(
                &crate::storage::lock_storage().unwrap(),
                || Err("path failure".to_owned()),
                history_input("av123")
            )
            .unwrap_err(),
            "path failure"
        );
        for bytes in ["{broken", r#"{"version":999,"items":[]}"#] {
            fs::write(&path, bytes).unwrap();
            let error = super::record_play_at(
                &crate::storage::lock_storage().unwrap(),
                || Ok(path.clone()),
                history_input("av123"),
            )
            .unwrap_err();
            assert!(!error.starts_with("无效的 BV 号"));
            assert!(
                super::get_play_history_at(&crate::storage::lock_storage().unwrap(), || Ok(
                    path.clone()
                ))
                .is_err()
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        }
        fs::remove_file(&path).unwrap();
        for bvid in ["", "av123", "bv1GF4X6MEb1"] {
            assert!(super::record_play_at(
                &crate::storage::lock_storage().unwrap(),
                || Ok(path.clone()),
                history_input(bvid)
            )
            .unwrap_err()
            .starts_with("无效的 BV 号"));
            assert!(!path.exists());
        }
    }

    #[test]
    fn history_record_resolves_path_twice_and_get_clear_once() {
        let path = test_path();
        let calls = std::cell::Cell::new(0);
        let resolve = || {
            calls.set(calls.get() + 1);
            Ok(path.clone())
        };
        super::record_search_history_at(
            &crate::storage::lock_storage().unwrap(),
            resolve,
            "valid".to_owned(),
        )
        .unwrap();
        assert_eq!(calls.replace(0), 2);
        super::get_search_history_at(&crate::storage::lock_storage().unwrap(), resolve).unwrap();
        assert_eq!(calls.replace(0), 1);
        super::clear_search_history_at(&crate::storage::lock_storage().unwrap(), resolve).unwrap();
        assert_eq!(calls.replace(0), 1);
        fs::remove_file(&path).unwrap();
        super::record_play_at(
            &crate::storage::lock_storage().unwrap(),
            resolve,
            history_input("BV1GF4X6MEb1"),
        )
        .unwrap();
        assert_eq!(calls.replace(0), 2);
        super::get_play_history_at(&crate::storage::lock_storage().unwrap(), resolve).unwrap();
        assert_eq!(calls.get(), 1);
        fs::remove_file(path).unwrap();
    }
}
