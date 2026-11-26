use crate::search::SearchVideo;
use crate::storage::{self, StorageGuard};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const VERSION: u8 = 1;
const MAX_HISTORY: usize = 10;
const MAX_RESULTS: usize = 100;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryItem {
    keyword: String,
    searched_at: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchPage {
    keyword: String,
    tids: u32,
    sort_mode: String,
    items: Vec<SearchVideo>,
    page: u32,
    has_more: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LastResult {
    #[serde(flatten)]
    page: SearchPage,
    saved_at: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchState {
    version: u8,
    history: Vec<HistoryItem>,
    last_result: Option<LastResult>,
}

impl Default for SearchState {
    fn default() -> Self {
        Self {
            version: VERSION,
            history: Vec::new(),
            last_result: None,
        }
    }
}

fn path() -> Result<PathBuf, String> {
    Ok(crate::library::library_root()?.join("search_state.json"))
}

fn read(guard: &StorageGuard, path: &Path) -> Result<SearchState, String> {
    match storage::read(guard, path) {
        Ok(bytes) => Ok(serde_json::from_slice::<SearchState>(&bytes)
            .ok()
            .filter(|state| state.version == VERSION)
            .unwrap_or_default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SearchState::default()),
        Err(_) => Err("无法读取搜索缓存".into()),
    }
}

fn write_page(path: &Path, mut page: SearchPage, now: u64) -> Result<Vec<HistoryItem>, String> {
    let guard = storage::lock_storage()?;
    let mut state = read(&guard, path)?;
    page.keyword = page.keyword.trim().to_owned();
    if page.page == 0 {
        return Err("搜索页码无效".into());
    }
    if page.page == 1 {
        if !page.keyword.is_empty() {
            let key = page.keyword.to_lowercase();
            state
                .history
                .retain(|item| item.keyword.trim().to_lowercase() != key);
            state.history.insert(
                0,
                HistoryItem {
                    keyword: page.keyword.clone(),
                    searched_at: now,
                },
            );
            state.history.truncate(MAX_HISTORY);
        }
        page.items.truncate(MAX_RESULTS);
        state.last_result = Some(LastResult {
            page,
            saved_at: now,
        });
    } else {
        let Some(last) = state.last_result.as_mut() else {
            return Ok(state.history);
        };
        let cached = &mut last.page;
        if cached.items.len() >= MAX_RESULTS
            || cached.page.checked_add(1) != Some(page.page)
            || cached.keyword != page.keyword
            || cached.tids != page.tids
            || cached.sort_mode != page.sort_mode
        {
            return Ok(state.history);
        }
        let remaining = MAX_RESULTS - cached.items.len();
        // Fetch this page again after restarting if its tail did not fit in the cache.
        if page.items.len() <= remaining {
            cached.page = page.page;
            cached.has_more = page.has_more;
        }
        cached.items.extend(page.items.into_iter().take(remaining));
        last.saved_at = now;
    }
    storage::write_json_atomic(&guard, path, &state)?;
    Ok(state.history)
}

#[tauri::command]
pub(crate) fn get_search_state() -> Result<SearchState, String> {
    read(&storage::lock_storage()?, &path()?)
}

#[tauri::command]
pub(crate) fn write_search_state(page: SearchPage) -> Result<Vec<HistoryItem>, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    write_page(&path()?, page, now)
}

fn remove_history(path: &Path, keyword: Option<&str>) -> Result<Vec<HistoryItem>, String> {
    let guard = storage::lock_storage()?;
    let mut state = read(&guard, path)?;
    match keyword {
        Some(keyword) => {
            let key = keyword.trim().to_lowercase();
            state
                .history
                .retain(|item| item.keyword.trim().to_lowercase() != key);
        }
        None => state.history.clear(),
    }
    storage::write_json_atomic(&guard, path, &state)?;
    Ok(state.history)
}

#[tauri::command]
pub(crate) fn delete_search_state_history(keyword: String) -> Result<Vec<HistoryItem>, String> {
    remove_history(&path()?, Some(&keyword))
}

#[tauri::command]
pub(crate) fn clear_search_state_history() -> Result<Vec<HistoryItem>, String> {
    remove_history(&path()?, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("bili-s4-search-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("search_state.json");
        (dir, path)
    }

    fn page(keyword: &str, number: u32, from: usize, count: usize) -> SearchPage {
        SearchPage {
            keyword: keyword.into(),
            tids: 28,
            sort_mode: "single".into(),
            items: (from..from + count)
                .map(|index| SearchVideo {
                    bvid: format!("BV{index:010}"),
                    title: format!("合成曲目 {index}"),
                    uploader: "合成作者".into(),
                    thumbnail_url: String::new(),
                    duration_seconds: 60,
                    play_count: None,
                    pubdate: None,
                })
                .collect(),
            page: number,
            has_more: true,
        }
    }

    fn load(path: &Path) -> SearchState {
        read(&storage::lock_storage().unwrap(), path).unwrap()
    }

    #[test]
    fn loads_new_file_atomically_and_ignores_damage_or_wrong_version() {
        let (dir, path) = fixture();
        assert!(load(&path).last_result.is_none());
        write_page(&path, page("合成", 1, 1, 3), 100).unwrap();
        let restored = load(&path).last_result.unwrap();
        assert_eq!(restored.page.items.len(), 3);
        assert_eq!(restored.saved_at, 100);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        for content in [
            r#"broken"#,
            r#"{"version":2,"history":[],"lastResult":null}"#,
        ] {
            std::fs::write(&path, content).unwrap();
            let state = load(&path);
            assert!(state.history.is_empty());
            assert!(state.last_result.is_none());
        }
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn history_is_trimmed_recent_distinct_and_capped_with_independent_deletion() {
        let (dir, path) = fixture();
        assert!(write_page(&path, page("   ", 1, 1, 3), 1)
            .unwrap()
            .is_empty());
        for index in 0..12 {
            write_page(&path, page(&format!("Song {index}"), 1, 1, 1), index).unwrap();
        }
        let history = write_page(&path, page("  SONG 5   ", 1, 1, 1), 50).unwrap();
        assert_eq!(history.len(), 10);
        assert_eq!(history[0].keyword, "SONG 5");
        assert_eq!(history[0].searched_at, 50);
        assert_eq!(
            history
                .iter()
                .filter(|item| item.keyword.eq_ignore_ascii_case("song 5"))
                .count(),
            1
        );
        assert_eq!(remove_history(&path, Some(" song 5 ")).unwrap().len(), 9);
        assert!(remove_history(&path, None).unwrap().is_empty());
        assert_eq!(load(&path).last_result.unwrap().page.keyword, "SONG 5");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn replacement_and_append_keep_the_cursor_at_the_last_complete_page() {
        let (dir, path) = fixture();
        write_page(&path, page("甲", 1, 1, 90), 10).unwrap();
        write_page(&path, page("甲", 2, 91, 9), 20).unwrap();
        write_page(&path, page("甲", 3, 100, 20), 30).unwrap();
        write_page(&path, page("甲", 4, 120, 20), 40).unwrap();
        let last = load(&path).last_result.unwrap();
        assert_eq!(last.page.items.len(), 100);
        assert_eq!(last.page.items[99].bvid, "BV0000000100");
        assert_eq!(last.page.page, 2);
        assert!(last.page.has_more);
        assert_eq!(last.saved_at, 30);
        write_page(&path, page("乙", 1, 201, 2), 50).unwrap();
        assert_eq!(
            load(&path).last_result.unwrap().page.items[0].bvid,
            "BV0000000201"
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn rejected_write_and_stale_next_page_leave_previous_bytes_unchanged() {
        let (dir, path) = fixture();
        write_page(&path, page("已成功", 1, 1, 5), 10).unwrap();
        let original = std::fs::read(&path).unwrap();
        assert!(write_page(&path, page("失败", 0, 1, 0), 11).is_err());
        write_page(&path, page("已取消", 2, 6, 5), 12).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let state = load(&path);
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].keyword, "已成功");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
