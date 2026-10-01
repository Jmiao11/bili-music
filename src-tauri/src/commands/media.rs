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
pub(crate) async fn get_video_meta(
    state: tauri::State<'_, AppState>,
    bvid: String,
) -> Result<lyrics::VideoMeta, String> {
    let cookie_header = state.guest.guest_cookie_header().await?;
    let meta = lyrics::fetch_video_meta(&bvid, &cookie_header).await?;
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
pub(crate) async fn resolve_lyrics(
    state: tauri::State<'_, AppState>,
    bvid: String,
    cid: i64,
    force: Option<bool>,
) -> Result<lyrics::ResolveOutcome, String> {
    let cookie_header = state.guest.guest_cookie_header().await?;
    lyrics::resolve_lyrics(&bvid, cid, force.unwrap_or(false), &cookie_header).await
}
