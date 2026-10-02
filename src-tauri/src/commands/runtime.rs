use crate::{AppState, StreamSource};
use bilibili_music_core::yt_dlp_path;
use serde::Serialize;
use std::process::Command;

#[tauri::command]
pub(crate) async fn get_stream_source(state: tauri::State<'_, AppState>) -> Result<String, String> {
    Ok(state.stream_source.read().await.as_str().to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct YtDlpAvailability {
    available: bool,
    path: String,
}

#[tauri::command]
pub(crate) fn get_yt_dlp_availability() -> Result<YtDlpAvailability, String> {
    let path = yt_dlp_path();
    Ok(YtDlpAvailability {
        available: path.is_file(),
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub(crate) async fn set_stream_source(
    state: tauri::State<'_, AppState>,
    source: String,
) -> Result<String, String> {
    let parsed = StreamSource::parse(&source)?;
    *state.stream_source.write().await = parsed;
    eprintln!("[runtime] stream source switched to {}", parsed.as_str());
    Ok(parsed.as_str().to_owned())
}

#[tauri::command]
pub(crate) fn open_bilibili_video(bv_id: String) -> Result<(), String> {
    let bv_id = bv_id.trim();
    if !is_valid_bvid(bv_id) {
        return Err(format!("invalid Bilibili BV ID: {bv_id}"));
    }

    let url = format!("https://www.bilibili.com/video/{bv_id}");
    open_url_in_system_browser(&url)
}

fn is_valid_bvid(value: &str) -> bool {
    value.len() == 12
        && value.starts_with("BV")
        && value[2..].bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn open_url_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open system browser: {error}"))
}

#[cfg(test)]
mod tests {
    use super::is_valid_bvid;

    #[test]
    fn validates_bvid_before_opening_external_browser() {
        assert!(is_valid_bvid("BV1faGX65EgK"));
        assert!(!is_valid_bvid("av123"));
        assert!(!is_valid_bvid(
            "https://www.bilibili.com/video/BV1faGX65EgK"
        ));
    }

    #[test]
    fn yt_dlp_availability_contract_fixture() {
        crate::contract_tests::assert_fixture(
            "yt-dlp-availability",
            &super::YtDlpAvailability {
                available: true,
                path: "C:/tools/yt-dlp.exe".into(),
            },
        );
    }
}
