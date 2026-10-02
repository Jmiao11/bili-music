use bilibili_music_core::{
    resolve_bilibili_audio_cancellable_with_page, AudioError, StreamAudioInfo,
};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub(crate) async fn resolve_with_ytdlp(
    bv_id_for_log: &str,
    resolving_bv_id: &str,
    page: Option<u32>,
    cancellation: Arc<AtomicBool>,
    label: &str,
) -> Result<StreamAudioInfo, String> {
    let resolving_bv_id = resolving_bv_id.to_owned();
    let resolution = tauri::async_runtime::spawn_blocking(move || {
        resolve_bilibili_audio_cancellable_with_page(&resolving_bv_id, page, &cancellation)
    })
    .await;
    match resolution {
        Ok(Ok(info)) => Ok(info),
        Ok(Err(error)) => {
            if !matches!(error, AudioError::Cancelled) {
                eprintln!("[prepare_audio][{label}] {bv_id_for_log}: {error}");
            }
            Err(error.to_string())
        }
        Err(error) => {
            let message = format!("audio task failed: {error}");
            eprintln!("[prepare_audio][{label}] {bv_id_for_log}: {message}");
            Err(message)
        }
    }
}
