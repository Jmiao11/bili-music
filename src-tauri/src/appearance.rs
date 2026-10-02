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
const BACKGROUND_FILE_STEM: &str = "background";

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
        Some(path) => tauri::async_runtime::spawn_blocking(move || {
            let mut image = prepare_background(&path)?;
            let storage_guard = crate::storage::lock_storage()?;
            let internal = store_background_copy(&storage_guard, &path)?;
            image.path = internal.to_string_lossy().into_owned();
            Ok(Some(image))
        })
        .await
        .map_err(|error| format!("背景处理任务失败：{error}"))?,
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
    let bytes = {
        let guard = crate::storage::lock_storage()?;
        read_background_snapshot(&guard, path)?
    };
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes));
    if let Ok(format) = image::ImageFormat::from_path(path) {
        reader.set_format(format);
    }
    let reader = reader
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

fn read_background_snapshot(
    guard: &crate::storage::StorageGuard,
    path: &Path,
) -> Result<Vec<u8>, String> {
    if !path.is_file() {
        return Err("背景图片不存在或已被移动。".to_owned());
    }
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取背景图片：{error}"))?;
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err("背景图片超过 50 MB，请选择尺寸更合适的图片。".to_owned());
    }
    crate::storage::read(guard, path).map_err(|error| format!("无法打开背景图片：{error}"))
}

fn store_background_copy(
    guard: &crate::storage::StorageGuard,
    source: &Path,
) -> Result<PathBuf, String> {
    let dir = background_store_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("无法创建背景图片目录 {}：{error}", dir.display()))?;
    remove_existing_background_copies(guard, &dir)?;

    let ext = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "img".to_owned());
    let internal = dir.join(BACKGROUND_FILE_STEM).with_extension(ext);
    crate::storage::copy(guard, source, &internal).map_err(|error| {
        format!(
            "无法保存背景图片副本 {} 到 {}：{error}",
            source.display(),
            internal.display()
        )
    })?;
    Ok(internal)
}

fn remove_existing_background_copies(
    guard: &crate::storage::StorageGuard,
    dir: &Path,
) -> Result<(), String> {
    for entry in fs::read_dir(dir)
        .map_err(|error| format!("无法读取背景图片目录 {}：{error}", dir.display()))?
    {
        let path = entry
            .map_err(|error| format!("无法读取背景图片目录项：{error}"))?
            .path();
        if path.is_file()
            && path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|stem| stem == BACKGROUND_FILE_STEM)
        {
            crate::storage::remove_file(guard, &path)
                .map_err(|error| format!("无法删除旧背景图片副本 {}：{error}", path.display()))?;
        }
    }
    Ok(())
}

fn background_store_dir() -> Result<PathBuf, String> {
    crate::library::library_root()
}

#[cfg(test)]
mod tests {
    use super::{MAX_IMAGE_EDGE, MAX_SOURCE_BYTES};

    #[test]
    fn background_root_matches_library_root_without_creating_it() {
        let expected = crate::library::library_root().unwrap();
        let existed = expected.exists();
        assert_eq!(super::background_store_dir().unwrap(), expected);
        assert_eq!(expected.exists(), existed);
    }

    #[test]
    fn background_limits_remain_bounded_for_webview_use() {
        assert_eq!(MAX_IMAGE_EDGE, 2560);
        assert_eq!(MAX_SOURCE_BYTES, 50 * 1024 * 1024);
    }
}
