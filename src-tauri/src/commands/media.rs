use crate::guest_playurl::VideoPage;
use crate::{lyrics, AppState};

#[tauri::command]
pub(crate) async fn get_video_pages(
    state: tauri::State<'_, AppState>,
    bv_id: String,
) -> Result<Vec<VideoPage>, String> {
    state.guest.pages(&bv_id).await
}

#[tauri::command]
pub(crate) async fn get_video_meta(bvid: String) -> Result<lyrics::VideoMeta, String> {
    let meta = lyrics::fetch_video_meta(&bvid).await?;
    if meta.videos >= 1 {
        let videos = meta.videos;
        let pages = meta.pages.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = lyrics::cache_video_pages(bvid, videos, pages) {
                eprintln!("[video-pages-cache] write failed: {error}");
            }
        });
    }
    Ok(meta)
}

#[tauri::command]
pub(crate) async fn get_collection_page(
    state: tauri::State<'_, AppState>,
    bvid: String,
    collection_id: i64,
    page: u32,
) -> Result<lyrics::CollectionPage, String> {
    if page == 0 {
        return Err("合集页码必须大于 0".to_owned());
    }
    {
        let cache = state.collection_cache.read().await;
        if let Some((id, origin, items)) = cache.as_ref() {
            if *id == collection_id && origin == &bvid {
                return lyrics::collection_page(items, page);
            }
        }
    }
    let (_, items) = lyrics::fetch_collection(&bvid, collection_id)
        .await
        .map_err(|error| crate::ai::safe_error(&error, ""))?;
    let result = lyrics::collection_page(&items, page)?;
    *state.collection_cache.write().await = Some((collection_id, bvid, items));
    Ok(result)
}

#[tauri::command]
pub(crate) async fn resolve_lyrics(
    bvid: String,
    cid: i64,
    force: Option<bool>,
) -> Result<lyrics::ResolveOutcome, String> {
    lyrics::resolve_lyrics(&bvid, cid, force.unwrap_or(false)).await
}
