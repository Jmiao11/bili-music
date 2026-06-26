use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::ImageReader;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_SOURCE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_IMAGE_EDGE: u32 = 2560;
const JPEG_QUALITY: u8 = 86;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImage {
    path: String,
    display_name: String,
    data_url: String,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn choose_background_image() -> Result<Option<BackgroundImage>, String> {
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择背景图片")
            .add_filter("图片", &["jpg", "jpeg", "png", "webp", "bmp"])
            .pick_file()
    })
    .await
    .map_err(|error| format!("背景选择器启动失败：{error}"))?;

    match path {
        Some(path) => load_background_path(path).await.map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn load_background_image(path: String) -> Result<BackgroundImage, String> {
    load_background_path(PathBuf::from(path)).await
}

async fn load_background_path(path: PathBuf) -> Result<BackgroundImage, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_background(&path))
        .await
        .map_err(|error| format!("背景处理任务失败：{error}"))?
}

fn prepare_background(path: &Path) -> Result<BackgroundImage, String> {
    if !path.is_file() {
        return Err("背景图片不存在或已被移动。".to_owned());
    }

    let metadata = fs::metadata(path).map_err(|error| format!("无法读取背景图片：{error}"))?;
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err("背景图片超过 50 MB，请选择尺寸更合适的图片。".to_owned());
    }

    let reader = ImageReader::open(path)
        .map_err(|error| format!("无法打开背景图片：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("无法识别背景图片格式：{error}"))?;
    let image = reader
        .decode()
        .map_err(|error| format!("背景图片解码失败：{error}"))?;
    let image = if image.width() > MAX_IMAGE_EDGE || image.height() > MAX_IMAGE_EDGE {
        image.resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, FilterType::Triangle)
    } else {
        image
    };
    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    let mut encoded = Vec::new();
    JpegEncoder::new_with_quality(&mut encoded, JPEG_QUALITY)
        .encode(&rgb, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|error| format!("背景图片压缩失败：{error}"))?;

    let display_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("自定义背景")
        .to_owned();
    Ok(BackgroundImage {
        path: path.to_string_lossy().into_owned(),
        display_name,
        data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(encoded)),
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::{MAX_IMAGE_EDGE, MAX_SOURCE_BYTES};

    #[test]
    fn background_limits_remain_bounded_for_webview_use() {
        assert_eq!(MAX_IMAGE_EDGE, 2560);
        assert_eq!(MAX_SOURCE_BYTES, 50 * 1024 * 1024);
    }
}
