use crate::home_feed::{FeedResult, Mode, Source};
use crate::search::SearchVideo;
use crate::{ai, AppState};

#[tauri::command]
pub(crate) async fn search_videos(
    state: tauri::State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
    tids: Option<u32>,
    order: Option<String>,
    sort_mode: Option<String>,
    rerank: bool,
) -> Result<Vec<SearchVideo>, String> {
    state
        .search
        .search_videos_page(
            &keyword,
            page.unwrap_or(1),
            tids,
            order.as_deref(),
            sort_mode.as_deref(),
            rerank,
        )
        .await
}

#[tauri::command]
pub(crate) async fn get_music_ranking(
    state: tauri::State<'_, AppState>,
    source: Source,
    mode: Mode,
    today: String,
) -> Result<FeedResult, String> {
    state
        .home_feed
        .load(&state.ranking, source, mode, today)
        .await
}

#[tauri::command]
pub(crate) async fn get_recommendations(
    state: tauri::State<'_, AppState>,
    user_hint: Option<String>,
) -> Result<Vec<SearchVideo>, String> {
    let recommendations = ai::generate_recommendations(&state.search, user_hint).await?;
    if !recommendations.is_empty() {
        if let Err(error) = ai::save_recommendations(&recommendations) {
            eprintln!("failed to save recommendations: {error}");
        }
    }
    Ok(recommendations)
}
