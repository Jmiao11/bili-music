use super::{
    library_root, DISABLED_PAGES_FILE, FAVORITES_FILE, PLAYBACK_STATE_FILE, PLAYLISTS_FILE,
    PLAY_HISTORY_FILE, SEARCH_HISTORY_FILE, SHORTCUTS_FILE, UNAVAILABLE_TRACKS_FILE,
};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::path::Path;
use uuid::Uuid;
use zip::write::SimpleFileOptions;

const AI_CONFIG_FILE: &str = "ai-config.json";
const BACKUP_JSON_FILES: &[&str] = &[
    FAVORITES_FILE,
    PLAYLISTS_FILE,
    SEARCH_HISTORY_FILE,
    PLAY_HISTORY_FILE,
    PLAYBACK_STATE_FILE,
    UNAVAILABLE_TRACKS_FILE,
    DISABLED_PAGES_FILE,
    SHORTCUTS_FILE,
    "loudness.json",
    AI_CONFIG_FILE,
    "recommendations.json",
    "lyrics-offsets.json",
    "lyrics-bindings.json",
    "video-pages-cache.json",
];
const BACKUP_BACKGROUND_FILES: &[&str] = &[
    "background.jpg",
    "background.jpeg",
    "background.png",
    "background.webp",
    "background.bmp",
    "background.img",
];
// 背景图现有限制为 50 MiB；总量给 13 个 JSON 留余量，同时限制 ZIP 解压后的内存占用。
const MAX_IMPORT_ENTRY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_IMPORT_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
#[tauri::command]
pub async fn export_data() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(export_data_blocking)
        .await
        .map_err(|error| format!("数据导出任务失败：{error}"))?
}

#[tauri::command]
pub async fn import_data() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(import_data_blocking)
        .await
        .map_err(|error| format!("数据导入任务失败：{error}"))?
}

fn export_data_blocking() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name("bili-music-backup.zip")
        .add_filter("Zip", &["zip"])
        .save_file()
    else {
        return Ok(None);
    };

    let root = library_root()?;
    let file = File::create(&path)
        .map_err(|error| format!("无法创建备份文件 {}：{error}", path.display()))?;
    export_data_at(&root, file)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn export_data_at<W: Write + Seek>(root: &Path, output: W) -> Result<W, String> {
    let files = {
        let guard = crate::storage::lock_storage()?;
        export_snapshot(&guard, root)?
    };
    let mut zip = zip::ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in files {
        zip.start_file(&name, options)
            .map_err(|error| format!("无法写入备份条目 {name}：{error}"))?;
        zip.write_all(&bytes)
            .map_err(|error| format!("无法写入备份条目 {name}：{error}"))?;
    }
    zip.finish()
        .map_err(|error| format!("无法完成备份文件：{error}"))
}

fn export_snapshot(
    guard: &crate::storage::StorageGuard,
    root: &Path,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut files = Vec::new();
    if root.exists() {
        for entry in fs::read_dir(root)
            .map_err(|error| format!("无法读取数据目录 {}：{error}", root.display()))?
        {
            let path = entry
                .map_err(|error| format!("无法读取数据目录项：{error}"))?
                .path();
            if !path.is_file() {
                continue;
            }
            let Some(file_name) = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
            else {
                continue;
            };
            if file_name.contains(".tmp")
                || file_name.ends_with(".backup")
                || file_name.starts_with("ai-config.json.bak-")
            {
                continue;
            }
            let mut bytes = crate::storage::read(guard, &path)
                .map_err(|error| format!("无法读取数据文件 {}：{error}", path.display()))?;
            if file_name == AI_CONFIG_FILE {
                let mut config: serde_json::Value = serde_json::from_slice(&bytes)
                    .map_err(|error| format!("AI 配置格式损坏：{error}"))?;
                let fields = config
                    .as_object_mut()
                    .ok_or_else(|| "AI 配置不是 JSON 对象。".to_owned())?;
                fields.remove("api_key");
                bytes = serde_json::to_vec(&config)
                    .map_err(|error| format!("无法写入备份条目 {file_name}：{error}"))?;
            }
            files.push((file_name, bytes));
        }
    }
    Ok(files)
}

fn import_data_blocking() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Zip", &["zip"])
        .pick_file()
    else {
        return Ok(None);
    };

    let root = library_root().map_err(|error| format!("导入失败，现有数据未被修改：{error}"))?;
    let file = File::open(&path).map_err(|error| {
        format!(
            "导入失败，现有数据未被修改：无法打开备份文件 {}：{error}",
            path.display()
        )
    })?;
    let (imported, skipped) = import_data_at(&root, file, |guard, path, bytes| {
        crate::storage::write_bytes_atomic(guard, path, bytes)
    })
    .map_err(|error| {
        if error.starts_with("回滚未完成") || error.starts_with("文件已导入") {
            format!("导入失败：{error}")
        } else {
            format!("导入失败，现有数据未被修改：{error}")
        }
    })?;
    Ok(Some(format!(
        "导入了 {imported} 个文件，跳过了 {skipped} 个不认识的条目。"
    )))
}

fn read_import_files<R: Read + Seek>(input: R) -> Result<(Vec<(String, Vec<u8>)>, usize), String> {
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| format!("备份文件不是有效 zip：{error}"))?;
    let mut files = Vec::<(String, Vec<u8>)>::new();
    let mut names = HashSet::new();
    let mut skipped = 0;
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取备份条目 #{index}：{error}"))?;
        let name = entry.name().to_owned();
        if entry.is_dir()
            || !BACKUP_JSON_FILES.contains(&name.as_str())
                && !BACKUP_BACKGROUND_FILES.contains(&name.as_str())
        {
            skipped += 1;
            continue;
        }
        if !names.insert(name.clone()) {
            return Err(format!("备份包含重复条目 {name}。"));
        }
        if entry.size() > MAX_IMPORT_ENTRY_BYTES
            || total.saturating_add(entry.size()) > MAX_IMPORT_TOTAL_BYTES
        {
            return Err(format!("备份条目 {name} 超过大小上限。"));
        }
        let mut bytes = Vec::new();
        entry
            .take(MAX_IMPORT_ENTRY_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("无法解压备份条目 {name}：{error}"))?;
        total = total.saturating_add(bytes.len() as u64);
        if bytes.len() as u64 > MAX_IMPORT_ENTRY_BYTES || total > MAX_IMPORT_TOTAL_BYTES {
            return Err(format!("备份条目 {name} 超过大小上限。"));
        }
        if name.ends_with(".json") {
            let json: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("备份条目 {name} 的 JSON 格式损坏：{error}"))?;
            if name != AI_CONFIG_FILE || json.get("api_key").is_some() || !json.is_object() {
                validate_backup_json(&name, &bytes)?;
            }
        }
        files.push((name, bytes));
    }

    Ok((files, skipped))
}

fn import_data_at<R: Read + Seek>(
    root: &Path,
    input: R,
    write_file: impl FnMut(&crate::storage::StorageGuard, &Path, &[u8]) -> std::io::Result<()>,
) -> Result<(usize, usize), String> {
    let (mut files, skipped) = read_import_files(input)?;
    let guard = crate::storage::lock_storage()?;
    complete_ai_key(&guard, root, &mut files)?;
    import_files_at(&guard, root, files, skipped, write_file)
}

fn complete_ai_key(
    guard: &crate::storage::StorageGuard,
    root: &Path,
    files: &mut [(String, Vec<u8>)],
) -> Result<(), String> {
    for (name, bytes) in files {
        if name == AI_CONFIG_FILE {
            let mut json: serde_json::Value = serde_json::from_slice(bytes)
                .map_err(|error| format!("备份条目 {name} 的 JSON 格式损坏：{error}"))?;

            let fields = json
                .as_object_mut()
                .ok_or_else(|| "备份中的 AI 配置不是 JSON 对象。".to_owned())?;
            if !fields.contains_key("api_key") {
                let existing = root.join(AI_CONFIG_FILE);
                let key = if existing.exists() {
                    let current: serde_json::Value = serde_json::from_slice(
                        &crate::storage::read(guard, &existing)
                            .map_err(|error| format!("无法读取本机 AI 配置：{error}"))?,
                    )
                    .map_err(|error| format!("本机 AI 配置格式损坏：{error}"))?;
                    current
                        .get("api_key")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .to_owned()
                } else {
                    String::new()
                };
                fields.insert("api_key".to_owned(), serde_json::Value::String(key));
                *bytes = serde_json::to_vec(&json)
                    .map_err(|error| format!("无法处理 AI 配置：{error}"))?;
                validate_backup_json(name, bytes)?;
            }
        }
    }
    Ok(())
}

fn validate_backup_json(name: &str, bytes: &[u8]) -> Result<(), String> {
    let result = match name {
        FAVORITES_FILE => super::favorites::validate_import_json(name, bytes),
        PLAYLISTS_FILE => super::playlists::validate_import_json(name, bytes),
        SEARCH_HISTORY_FILE => super::history::validate_search_import_json(name, bytes),
        PLAY_HISTORY_FILE => super::history::validate_play_import_json(name, bytes),
        PLAYBACK_STATE_FILE => super::playback_state::validate_import_json(name, bytes),
        UNAVAILABLE_TRACKS_FILE => super::unavailable::validate_import_json(name, bytes),
        DISABLED_PAGES_FILE => super::disabled_pages::validate_import_json(name, bytes),
        SHORTCUTS_FILE => super::shortcut_config::validate_import_json(name, bytes),
        "loudness.json" => super::loudness_store::validate_import_json(name, bytes),
        AI_CONFIG_FILE | "recommendations.json" => crate::ai::validate_import_json(name, bytes),
        "lyrics-offsets.json" | "lyrics-bindings.json" | "video-pages-cache.json" => {
            crate::lyrics::validate_import_json(name, bytes)
        }
        _ => unreachable!("backup JSON dispatch must cover the whitelist"),
    };
    result
        .map_err(|_| crate::ai::safe_error(&format!("备份条目 {name} 的数据结构或版本无效。"), ""))
}

fn import_files_at(
    guard: &crate::storage::StorageGuard,
    root: &Path,
    files: Vec<(String, Vec<u8>)>,
    skipped: usize,
    mut write_file: impl FnMut(&crate::storage::StorageGuard, &Path, &[u8]) -> std::io::Result<()>,
) -> Result<(usize, usize), String> {
    for (name, _) in &files {
        match fs::symlink_metadata(root.join(name)) {
            Ok(metadata) if !metadata.file_type().is_file() => {
                return Err(format!("现有路径 {name} 不是普通文件。"));
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("无法检查现有文件 {name}：{error}"));
            }
            _ => {}
        }
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("无法创建数据目录 {}：{error}", root.display()))?;
    let snapshot = root.join(format!(".import-rollback-{}", Uuid::new_v4()));
    fs::create_dir(&snapshot).map_err(|error| format!("无法创建回滚快照：{error}"))?;
    let mut existed = HashSet::new();
    for (name, _) in &files {
        let target = root.join(name);
        if target.exists() {
            if let Err(error) = crate::storage::copy(guard, &target, snapshot.join(name)) {
                let _ = fs::remove_dir_all(&snapshot);
                return Err(format!("无法保存 {name} 的回滚快照：{error}"));
            }
            existed.insert(name.clone());
        }
    }
    let mut written = Vec::new();
    for (name, bytes) in &files {
        written.push(name.as_str());
        if let Err(error) = write_file(guard, &root.join(name), bytes) {
            let mut rollback_errors = Vec::new();
            for written_name in written {
                let target = root.join(written_name);
                let restored = if existed.contains(written_name) {
                    crate::storage::copy(guard, snapshot.join(written_name), &target).map(|_| ())
                } else {
                    crate::storage::remove_file(guard, &target).or_else(|remove_error| {
                        if remove_error.kind() == std::io::ErrorKind::NotFound {
                            Ok(())
                        } else {
                            Err(remove_error)
                        }
                    })
                };
                if let Err(restore_error) = restored {
                    rollback_errors.push(format!("{written_name}: {restore_error}"));
                }
            }
            if !rollback_errors.is_empty() {
                return Err(format!(
                    "回滚未完成（快照保留在 {}）：{}；原错误：{error}",
                    snapshot.display(),
                    rollback_errors.join("；")
                ));
            }
            fs::remove_dir_all(&snapshot).map_err(|cleanup_error| {
                format!(
                    "回滚已完成，但无法删除快照 {}：{cleanup_error}",
                    snapshot.display()
                )
            })?;
            return Err(format!("写入 {name} 失败并已回滚：{error}"));
        }
    }
    fs::remove_dir_all(&snapshot).map_err(|error| {
        format!(
            "文件已导入，但无法删除回滚快照 {}：{error}",
            snapshot.display()
        )
    })?;
    Ok((files.len(), skipped))
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::{Cursor, Error};
    use std::path::PathBuf;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("bili-backup-test-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        root
    }

    fn backup(entries: &[(&str, &[u8])]) -> Cursor<Vec<u8>> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap()
    }

    fn declared_json_files(source: &str) -> Vec<&str> {
        let mut names = Vec::new();
        for (position, _) in source.match_indices("const") {
            if position > 0 && source.as_bytes()[position - 1].is_ascii_alphanumeric() {
                continue;
            }
            let tail = &source[position + 5..];
            if !tail.starts_with(char::is_whitespace) {
                continue;
            }
            let tail = tail.trim_start();
            let end = tail
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .unwrap_or(tail.len());
            if !tail[..end].ends_with("_FILE") {
                continue;
            }
            let mut rest = &tail[end..];
            let mut valid = true;
            for token in [":", "&", "str", "=", "\""] {
                if let Some(next) = rest.trim_start().strip_prefix(token) {
                    rest = next;
                } else {
                    valid = false;
                    break;
                }
            }
            if valid {
                if let Some(end) = rest.find('"') {
                    let name = &rest[..end];
                    if name.ends_with(".json") {
                        names.push(name);
                    }
                }
            }
        }
        names
    }

    #[test]
    fn every_declared_json_file_has_an_explicit_backup_decision() {
        // Ratchet guard (棘轮守卫), not a complete Rust AST analysis.
        // Visibility prefixes are irrelevant; whitespace/newlines around tokens are accepted.
        for declaration in [
            "const X_FILE: &str = \"index.json\";",
            "pub const X_FILE : & str = \"index.json\";",
            "pub(crate) const\nX_FILE\n:\n&str\n=\n\"index.json\";",
        ] {
            assert_eq!(declared_json_files(declaration), ["index.json"]);
        }
        let excluded = [
            "index.json", // Audio cache index lives in cache/audio/, not the backed-up root.
        ];
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut directories = vec![root.clone()];
        let mut seen = HashSet::new();
        while let Some(directory) = directories.pop() {
            for entry in fs::read_dir(directory).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    directories.push(path);
                } else if path.extension().is_some_and(|extension| extension == "rs") {
                    let source = fs::read_to_string(&path).unwrap();
                    for name in declared_json_files(&source) {
                        assert!(
                            BACKUP_JSON_FILES.contains(&name) || excluded.contains(&name),
                            "{}: {name} has no explicit backup decision",
                            path.display()
                        );
                        seen.insert(name.to_owned());
                    }
                }
            }
        }
        for name in BACKUP_JSON_FILES.iter().chain(excluded.iter()) {
            assert!(
                seen.contains(*name),
                "{name} is no longer declared; review the decision list"
            );
        }
    }

    #[test]
    fn every_backup_json_file_round_trips() {
        let source = temp_root();
        let target = temp_root();
        let mut expected = BTreeMap::new();
        let track = serde_json::json!({"bvid": "BV1GF4X6MEb1", "title": "备份测试歌曲",
            "uploader": "测试作者", "thumbnailUrl": "https://example.test/cover.jpg",
            "durationSeconds": 123, "addedAt": "123"});
        for &name in BACKUP_JSON_FILES {
            let value = match name {
                "favorites.json" => serde_json::json!({"version": 1, "items": [track.clone()]}),
                "search-history.json" => {
                    serde_json::json!({"version": 1, "items": [{"keyword": "音乐", "searchedAt": "123", "count": 2}]})
                }
                "play-history.json" => {
                    serde_json::json!({"version": 1, "items": [{"bvid": "BV1GF4X6MEb1", "title": "备份测试歌曲", "uploader": "测试作者", "thumbnailUrl": "https://example.test/cover.jpg", "durationSeconds": 123, "lastPlayedAt": "123", "count": 2}]})
                }
                "unavailable-tracks.json" => {
                    serde_json::json!({"version": 1, "items": [{"bvid": "BV1GF4X6MEb1", "reason": "测试原因", "markedAt": 123}]})
                }
                "loudness.json" => {
                    serde_json::json!({"version": 1, "items": [{"key": "BV1GF4X6MEb1:123", "lufs": -12.0, "measuredAt": 123}]})
                }
                "playlists.json" => {
                    serde_json::json!({"version": 1, "playlists": [{"id": "test-list", "name": "测试歌单", "createdAt": "123", "items": [track.clone()]}]})
                }
                "playback-state.json" => {
                    serde_json::json!({"version": 1, "queue": [track.clone()], "currentIndex": 0,
                    "positionSeconds": 12.5, "page": null, "cid": null, "savedAt": 123})
                }
                "disabled-pages.json" => {
                    serde_json::json!({"version": 1, "videos": {"BV1GF4X6MEb1": [123]}})
                }
                "shortcuts.json" => serde_json::json!({"version": 1, "bindings": {
                    "previous": null, "playPause": "Ctrl+P", "next": null, "volumeUp": null, "volumeDown": null}}),
                "ai-config.json" => {
                    serde_json::json!({"version": 1, "api_format": "openai-chat-completions",
                    "base_url": "https://example.test", "model": "test-model", "api_key": "secret"})
                }
                "recommendations.json" => {
                    serde_json::json!({"version": 1, "items": [{"bvid": "BV1GF4X6MEb1", "title": "备份测试歌曲", "uploader": "测试作者", "thumbnailUrl": "https://example.test/cover.jpg", "durationSeconds": 123, "playCount": 42, "pubdate": 123}], "generated_at": 123})
                }
                "lyrics-offsets.json" => {
                    serde_json::json!({"version": 1, "offsets": {"BV1GF4X6MEb1:123": 250}})
                }
                "lyrics-bindings.json" => {
                    serde_json::json!({"version": 1, "bindings": {"BV1GF4X6MEb1:123": {"song_id": "123", "song_name": "测试歌曲", "singer": "测试作者", "source": "manual", "confidence": 1.0, "checked_at": 123}}})
                }
                "video-pages-cache.json" => {
                    serde_json::json!({"version": 1, "entries": {"BV1GF4X6MEb1": {"videos": 1, "pages": [{"cid": 123, "page": 1, "part": "测试分P", "duration": 123}], "cached_at": 123}}})
                }
                other => panic!("add representative backup content for {other}"),
            };
            fs::write(source.join(name), serde_json::to_vec(&value).unwrap()).unwrap();
            expected.insert(name, value);
        }
        let archive = export_data_at(&source, Cursor::new(Vec::new())).unwrap();
        assert_eq!(
            import_data_at(&target, archive, |_guard, path, bytes| fs::write(
                path, bytes
            ))
            .unwrap(),
            (BACKUP_JSON_FILES.len(), 0)
        );
        expected.get_mut(AI_CONFIG_FILE).unwrap()["api_key"] = serde_json::json!("");
        for (name, value) in expected {
            let restored: serde_json::Value =
                serde_json::from_slice(&fs::read(target.join(name)).unwrap()).unwrap();
            assert_eq!(restored, value, "{name}");
        }
        assert_eq!(
            fs::read_dir(&target).unwrap().count(),
            BACKUP_JSON_FILES.len()
        );
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn export_excludes_real_ai_writer_residuals_and_all_secret_bytes() {
        let root = temp_root();
        let target = root.join(AI_CONFIG_FILE);
        let secret = "sk-backup-residual-test-secret";
        let config = serde_json::json!({"version": 1, "api_key": secret, "model": "test"});
        fs::write(&target, serde_json::to_vec(&config).unwrap()).unwrap();
        let tmp = crate::library::atomic_temp_path(&target);
        let bak = crate::library::atomic_backup_path(&target);
        let legacy_backup = root.join("ai-config.json.backup");
        for path in [&tmp, &bak, &legacy_backup] {
            fs::write(path, secret).unwrap();
        }
        let output = export_data_at(&root, Cursor::new(Vec::new())).unwrap();
        let mut archive = zip::ZipArchive::new(output).unwrap();
        for path in [&tmp, &bak, &legacy_backup] {
            assert!(archive
                .by_name(path.file_name().unwrap().to_str().unwrap())
                .is_err());
        }
        let exported: serde_json::Value =
            serde_json::from_reader(archive.by_name(AI_CONFIG_FILE).unwrap()).unwrap();
        assert!(exported.get("api_key").is_none());
        for index in 0..archive.len() {
            let mut contents = Vec::new();
            archive
                .by_index(index)
                .unwrap()
                .read_to_end(&mut contents)
                .unwrap();
            assert!(!contents
                .windows(secret.len())
                .any(|bytes| bytes == secret.as_bytes()));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_ai_config_removes_key_and_keeps_other_fields() {
        let root = temp_root();
        fs::write(
            root.join(AI_CONFIG_FILE),
            br#"{"version":1,"base_url":"https://example.test","model":"m","api_key":"secret"}"#,
        )
        .unwrap();
        fs::write(root.join(FAVORITES_FILE), b"{}").unwrap();
        fs::write(root.join("ai-config.json.bak-stale"), b"secret").unwrap();
        let output = export_data_at(&root, Cursor::new(Vec::new())).unwrap();
        let mut archive = zip::ZipArchive::new(output).unwrap();
        let config: serde_json::Value =
            serde_json::from_reader(archive.by_name(AI_CONFIG_FILE).unwrap()).unwrap();
        assert_eq!(config["model"], "m");
        assert_eq!(config["base_url"], "https://example.test");
        assert!(config.get("api_key").is_none());
        assert!(archive.by_name("ai-config.json.bak-stale").is_err());
        let mut favorites = String::new();
        archive
            .by_name(FAVORITES_FILE)
            .unwrap()
            .read_to_string(&mut favorites)
            .unwrap();
        assert_eq!(favorites, "{}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn import_skips_unknown_entries_and_counts_them() {
        let root = temp_root();
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            ("surprise.json", b"{}"),
            ("nested/playlists.json", b"{}"),
            ("background.png", b"image"),
        ]);
        assert_eq!(
            import_data_at(&root, zip, |_guard, path, bytes| fs::write(path, bytes)).unwrap(),
            (2, 2)
        );
        assert_eq!(
            fs::read(root.join(FAVORITES_FILE)).unwrap(),
            br#"{"version":1,"items":[]}"#
        );
        assert!(!root.join("surprise.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_json_rejects_entire_backup_before_writing() {
        let root = temp_root();
        fs::write(root.join(FAVORITES_FILE), b"old").unwrap();
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            (PLAYLISTS_FILE, b"invalid"),
        ]);
        assert!(
            import_data_at(&root, zip, |_guard, path, bytes| fs::write(path, bytes))
                .unwrap_err()
                .contains("JSON 格式损坏")
        );
        assert_eq!(fs::read(root.join(FAVORITES_FILE)).unwrap(), b"old");
        assert!(!root.join(PLAYLISTS_FILE).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_second_write_restores_overwritten_files() {
        let root = temp_root();
        fs::write(root.join(FAVORITES_FILE), b"old-favorites").unwrap();
        fs::write(root.join(PLAYLISTS_FILE), b"old-playlists").unwrap();
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            (PLAYLISTS_FILE, br#"{"version":1,"playlists":[]}"#),
        ]);
        let mut writes = 0;
        let error = import_data_at(&root, zip, |_guard, path, bytes| {
            writes += 1;
            if writes == 2 {
                fs::write(path, b"partial")?;
                return Err(Error::other("injected failure"));
            }
            fs::write(path, bytes)
        })
        .unwrap_err();
        assert!(error.contains("已回滚"));
        assert_eq!(
            fs::read(root.join(FAVORITES_FILE)).unwrap(),
            b"old-favorites"
        );
        assert_eq!(
            fs::read(root.join(PLAYLISTS_FILE)).unwrap(),
            b"old-playlists"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_rollback_reports_files_snapshot_and_original_error() {
        let root = temp_root();
        fs::write(root.join(FAVORITES_FILE), b"old-favorites").unwrap();
        fs::write(root.join(PLAYLISTS_FILE), b"old-playlists").unwrap();
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            (PLAYLISTS_FILE, br#"{"version":1,"playlists":[]}"#),
        ]);
        let mut writes = 0;
        let error = import_data_at(&root, zip, |_guard, path, bytes| {
            writes += 1;
            if writes == 2 {
                let snapshot = fs::read_dir(&root)?
                    .map(|entry| entry.unwrap().path())
                    .find(|path| {
                        path.file_name()
                            .unwrap()
                            .to_string_lossy()
                            .starts_with(".import-rollback-")
                    })
                    .unwrap();
                fs::remove_file(snapshot.join(FAVORITES_FILE))?;
                return Err(Error::other("injected write failure"));
            }
            fs::write(path, bytes)
        })
        .unwrap_err();
        assert!(error.starts_with("回滚未完成（快照保留在 "));
        assert!(error.contains(".import-rollback-"));
        assert!(error.contains("favorites.json:"));
        assert!(error.contains("原错误：injected write failure"));
        assert_eq!(
            fs::read(root.join(FAVORITES_FILE)).unwrap(),
            br#"{"version":1,"items":[]}"#
        );
        assert_eq!(
            fs::read(root.join(PLAYLISTS_FILE)).unwrap(),
            b"old-playlists"
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 3);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn old_backup_keeps_its_ai_key() {
        let root = temp_root();
        fs::write(
            root.join(AI_CONFIG_FILE),
            br#"{"version":1,"base_url":"https://local.test","model":"local","api_key":"local"}"#,
        )
        .unwrap();
        let zip = backup(&[(AI_CONFIG_FILE, br#"{"version":1,"base_url":"https://backup.test","model":"backup","api_key":"old-backup"}"#)]);
        assert_eq!(
            import_data_at(&root, zip, |_guard, path, bytes| fs::write(path, bytes)).unwrap(),
            (1, 0)
        );
        let config: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(AI_CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(config["api_key"], "old-backup");
        assert_eq!(config["model"], "backup");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn new_backup_preserves_local_ai_key() {
        let root = temp_root();
        fs::write(
            root.join(AI_CONFIG_FILE),
            br#"{"version":1,"base_url":"https://local.test","model":"local","api_key":"local"}"#,
        )
        .unwrap();
        let zip = backup(&[(
            AI_CONFIG_FILE,
            br#"{"version":1,"base_url":"https://backup.test","model":"new"}"#,
        )]);
        assert_eq!(
            import_data_at(&root, zip, |_guard, path, bytes| fs::write(path, bytes)).unwrap(),
            (1, 0)
        );
        let config: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(AI_CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(config["api_key"], "local");
        assert_eq!(config["model"], "new");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn disabled_pages_are_importable_from_backup() {
        assert!(super::BACKUP_JSON_FILES.contains(&super::DISABLED_PAGES_FILE));
    }
    fn concurrent_writer(
        root: PathBuf,
        operation: impl FnOnce() -> Result<(), String> + Send + 'static,
    ) -> (
        std::thread::JoinHandle<Result<(), String>>,
        std::sync::mpsc::Receiver<()>,
        std::sync::mpsc::Receiver<()>,
    ) {
        let (attempt_tx, attempt) = std::sync::mpsc::channel();
        let (done_tx, done) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            crate::storage::set_test_root(root);
            crate::storage::before_lock(move || attempt_tx.send(()).unwrap());
            let result = operation();
            done_tx.send(()).unwrap();
            result
        });
        (thread, attempt, done)
    }

    fn new_play() -> super::super::TrackSnapshotInput {
        super::super::TrackSnapshotInput {
            bvid: "BV1rW4y1Q7o7".into(),
            title: "new".into(),
            uploader: "u".into(),
            thumbnail_url: String::new(),
            duration_seconds: 1,
        }
    }

    fn imported_history() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"version":1,"items":[{
            "bvid":"BV1GF4X6MEb1","title":"imported","uploader":"u",
            "thumbnailUrl":"","durationSeconds":1,"lastPlayedAt":"1","count":1
        }]}))
        .unwrap()
    }

    fn wait_for_blocked_writer(done: &std::sync::mpsc::Receiver<()>) -> bool {
        // Negative assertion: after the writer reaches lock_storage, give it at least
        // 200 ms to report completion. No sleep is used to construct the interleaving.
        matches!(
            done.recv_timeout(std::time::Duration::from_millis(200)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        )
    }

    #[test]
    fn concurrent_lyrics_offsets_preserve_both_keys() {
        let root = temp_root();
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first_root = root.clone();
        let first = std::thread::spawn(move || {
            crate::storage::set_test_root(first_root);
            crate::storage::after_read(move |_| {
                read_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                true
            });
            tauri::async_runtime::block_on(crate::lyrics::set_lyrics_offset(
                "BV1GF4X6MEb1".into(),
                1,
                100,
            ))
        });
        read_rx.recv().unwrap();
        let (second, attempted, done) = concurrent_writer(root.clone(), || {
            tauri::async_runtime::block_on(crate::lyrics::set_lyrics_offset(
                "BV1rW4y1Q7o7".into(),
                2,
                200,
            ))
        });
        attempted.recv().unwrap();
        let blocked = wait_for_blocked_writer(&done);
        release_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();
        let offsets: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("lyrics-offsets.json")).unwrap()).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert_eq!(offsets["offsets"]["BV1GF4X6MEb1:1"], 100);
        assert_eq!(offsets["offsets"]["BV1rW4y1Q7o7:2"], 200);
        assert!(
            blocked,
            "second offset writer completed while first held storage"
        );
    }

    #[test]
    fn concurrent_import_then_record_play_preserves_import_and_new_record() {
        let root = temp_root();
        fs::write(root.join(PLAY_HISTORY_FILE), br#"{"version":1,"items":[]}"#).unwrap();
        let history = imported_history();
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            (PLAY_HISTORY_FILE, &history),
        ]);
        let (written_tx, written_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first_root = root.clone();
        let first = std::thread::spawn(move || {
            let mut writes = 0;
            import_data_at(&first_root, zip, |_guard, path, bytes| {
                fs::write(path, bytes)?;
                writes += 1;
                if writes == 1 {
                    written_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }
                Ok(())
            })
        });
        written_rx.recv().unwrap();
        let (second, attempted, done) = concurrent_writer(root.clone(), || {
            super::super::history::record_play(new_play())
        });
        attempted.recv().unwrap();
        let blocked = wait_for_blocked_writer(&done);
        release_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();
        let history: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(PLAY_HISTORY_FILE)).unwrap()).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert_eq!(history["items"].as_array().unwrap().len(), 2);
        assert_eq!(history["items"][0]["bvid"], "BV1rW4y1Q7o7");
        assert_eq!(history["items"][1]["title"], "imported");
        assert!(blocked, "record_play completed before import finished");
    }

    #[test]
    fn concurrent_failed_import_rolls_back_before_record_play() {
        let root = temp_root();
        fs::write(root.join(PLAY_HISTORY_FILE), br#"{"version":1,"items":[]}"#).unwrap();
        let history = imported_history();
        let zip = backup(&[
            (PLAY_HISTORY_FILE, &history),
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
        ]);
        let (written_tx, written_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first_root = root.clone();
        let first = std::thread::spawn(move || {
            let mut writes = 0;
            import_data_at(&first_root, zip, |_guard, path, bytes| {
                fs::write(path, bytes)?;
                writes += 1;
                if writes == 1 {
                    written_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                } else {
                    return Err(Error::other("injected concurrent import failure"));
                }
                Ok(())
            })
        });
        written_rx.recv().unwrap();
        let (second, attempted, done) = concurrent_writer(root.clone(), || {
            super::super::history::record_play(new_play())
        });
        attempted.recv().unwrap();
        let blocked = wait_for_blocked_writer(&done);
        release_tx.send(()).unwrap();
        assert!(first.join().unwrap().unwrap_err().contains("已回滚"));
        second.join().unwrap().unwrap();
        let history: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(PLAY_HISTORY_FILE)).unwrap()).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert_eq!(history["items"].as_array().unwrap().len(), 1);
        assert_eq!(history["items"][0]["bvid"], "BV1rW4y1Q7o7");
        assert!(blocked, "record_play completed before rollback finished");
    }

    #[test]
    fn concurrent_export_snapshot_precedes_purge_as_one_unit() {
        let root = temp_root();
        let track = serde_json::json!({"bvid":"BV1GF4X6MEb1","title":"old","uploader":"u",
            "thumbnailUrl":"","durationSeconds":1,"addedAt":"1"});
        fs::write(
            root.join(FAVORITES_FILE),
            serde_json::to_vec(&serde_json::json!({"version":1,"items":[track.clone()]})).unwrap(),
        )
        .unwrap();
        fs::write(root.join(PLAYLISTS_FILE), serde_json::to_vec(
            &serde_json::json!({"version":1,"playlists":[{"id":"p","name":"p","createdAt":"1","items":[track]}]})).unwrap()).unwrap();
        fs::write(root.join(UNAVAILABLE_TRACKS_FILE), serde_json::to_vec(
            &serde_json::json!({"version":1,"items":[{"bvid":"BV1GF4X6MEb1","reason":"bad","markedAt":1}]})).unwrap()).unwrap();
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first_root = root.clone();
        let first = std::thread::spawn(move || {
            crate::storage::after_read(move |path| {
                let name = path.file_name().unwrap().to_str().unwrap();
                if name != FAVORITES_FILE && name != PLAYLISTS_FILE {
                    return false;
                }
                read_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                true
            });
            export_data_at(&first_root, Cursor::new(Vec::new()))
        });
        read_rx.recv().unwrap();
        let (second, attempted, done) = concurrent_writer(root.clone(), || {
            super::super::unavailable::purge_unavailable_tracks().map(|_| ())
        });
        attempted.recv().unwrap();
        let blocked = wait_for_blocked_writer(&done);
        release_tx.send(()).unwrap();
        let zip = first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(zip.into_inner())).unwrap();
        let mut favorites = String::new();
        archive
            .by_name(FAVORITES_FILE)
            .unwrap()
            .read_to_string(&mut favorites)
            .unwrap();
        let mut playlists = String::new();
        archive
            .by_name(PLAYLISTS_FILE)
            .unwrap()
            .read_to_string(&mut playlists)
            .unwrap();
        let favorites: serde_json::Value = serde_json::from_str(&favorites).unwrap();
        let playlists: serde_json::Value = serde_json::from_str(&playlists).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert_eq!(favorites["items"].as_array().unwrap().len(), 1);
        assert_eq!(
            playlists["playlists"][0]["items"].as_array().unwrap().len(),
            1
        );
        assert!(
            blocked,
            "purge completed while the export snapshot was being read"
        );
    }
    fn minimal_backup_json(name: &str) -> serde_json::Value {
        match name {
            FAVORITES_FILE
            | SEARCH_HISTORY_FILE
            | PLAY_HISTORY_FILE
            | UNAVAILABLE_TRACKS_FILE
            | "loudness.json" => serde_json::json!({"version":1,"items":[]}),
            PLAYLISTS_FILE => serde_json::json!({"version":1,"playlists":[]}),
            PLAYBACK_STATE_FILE => serde_json::json!({"version":1,"queue":[],
                "currentIndex":0,"positionSeconds":0.0,"page":null,"cid":null,"savedAt":0}),
            DISABLED_PAGES_FILE => serde_json::json!({"version":1,"videos":{}}),
            SHORTCUTS_FILE => serde_json::json!({"version":1,"bindings":{}}),
            AI_CONFIG_FILE => serde_json::json!({"version":1,"base_url":"https://example.test",
                "model":"m","api_key":"backup-key"}),
            "recommendations.json" => serde_json::json!({"version":1,"items":[],"generated_at":0}),
            "lyrics-offsets.json" => serde_json::json!({"version":1,"offsets":{}}),
            "lyrics-bindings.json" => serde_json::json!({"version":1,"bindings":{}}),
            "video-pages-cache.json" => serde_json::json!({"version":1,"entries":{}}),
            _ => panic!("add a valid minimal fixture for {name}"),
        }
    }

    fn disk_snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fs::read_dir(root)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                assert!(
                    path.is_file(),
                    "unexpected disk mutation: {}",
                    path.display()
                );
                (
                    path.file_name().unwrap().to_str().unwrap().to_owned(),
                    fs::read(path).unwrap(),
                )
            })
            .collect()
    }

    fn assert_invalid_import_unchanged(name: &str, bytes: &[u8]) {
        let root = temp_root();
        fs::write(root.join("keep.json"), b"keep").unwrap();
        let before = disk_snapshot(&root);
        let good_name = if name == FAVORITES_FILE {
            PLAYLISTS_FILE
        } else {
            FAVORITES_FILE
        };
        let good = serde_json::to_vec(&minimal_backup_json(good_name)).unwrap();
        let zip = backup(&[(good_name, &good), (name, bytes)]);
        let mut writes = 0;
        let error = import_data_at(&root, zip, |guard, path, bytes| {
            writes += 1;
            crate::storage::write_bytes_atomic(guard, path, bytes)
        })
        .unwrap_err();
        assert_eq!(writes, 0, "{name}");
        assert_eq!(disk_snapshot(&root), before, "{name}");
        fs::remove_dir_all(root).unwrap();
        assert_eq!(error, format!("备份条目 {name} 的数据结构或版本无效。"));
    }

    #[test]
    fn import_rejects_wrong_structure_for_every_whitelisted_json_without_writing() {
        for &name in BACKUP_JSON_FILES {
            assert_invalid_import_unchanged(name, b"{}");
        }
    }

    #[test]
    fn import_rejects_unknown_versions_for_every_whitelisted_json_without_writing() {
        for &name in BACKUP_JSON_FILES {
            let mut value = minimal_backup_json(name);
            value["version"] = serde_json::json!(999);
            assert_invalid_import_unchanged(name, &serde_json::to_vec(&value).unwrap());
        }
    }

    #[test]
    fn import_rejects_ai_config_missing_required_fields_without_writing() {
        for field in ["version", "base_url", "model"] {
            let mut value = minimal_backup_json(AI_CONFIG_FILE);
            value.as_object_mut().unwrap().remove(field);
            assert_invalid_import_unchanged(AI_CONFIG_FILE, &serde_json::to_vec(&value).unwrap());
        }
    }

    #[test]
    fn import_ai_key_completion_failure_changes_no_files() {
        let root = temp_root();
        fs::write(
            root.join(AI_CONFIG_FILE),
            serde_json::to_vec(&minimal_backup_json(AI_CONFIG_FILE)).unwrap(),
        )
        .unwrap();
        fs::write(root.join(FAVORITES_FILE), b"old-favorites").unwrap();
        let before = disk_snapshot(&root);
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            (
                AI_CONFIG_FILE,
                br#"{"version":1,"base_url":"https://example.test","model":42}"#,
            ),
        ]);
        let mut writes = 0;
        let error = import_data_at(&root, zip, |guard, path, bytes| {
            writes += 1;
            crate::storage::write_bytes_atomic(guard, path, bytes)
        })
        .unwrap_err();
        assert_eq!(writes, 0);
        assert_eq!(disk_snapshot(&root), before);
        fs::remove_dir_all(root).unwrap();
        assert_eq!(error, "备份条目 ai-config.json 的数据结构或版本无效。");
    }

    #[test]
    fn import_preserves_original_bytes_for_every_complete_json_and_background() {
        let root = temp_root();
        let files: Vec<_> = BACKUP_JSON_FILES
            .iter()
            .map(|&name| {
                let mut value = minimal_backup_json(name);
                value["unknown_preserved_field"] = serde_json::json!("kept");
                let bytes = format!(
                    " 
{}

",
                    serde_json::to_string_pretty(&value).unwrap()
                )
                .into_bytes();
                (name, bytes)
            })
            .collect();
        let mut entries: Vec<_> = files
            .iter()
            .map(|(name, bytes)| (*name, bytes.as_slice()))
            .collect();
        entries.push(("background.png", b"not decoded in this batch"));
        let zip = backup(&entries);
        assert_eq!(
            import_data_at(&root, zip, crate::storage::write_bytes_atomic).unwrap(),
            (BACKUP_JSON_FILES.len() + 1, 0)
        );
        for (name, bytes) in files {
            assert_eq!(fs::read(root.join(name)).unwrap(), bytes, "{name}");
        }
        assert_eq!(
            fs::read(root.join("background.png")).unwrap(),
            b"not decoded in this batch"
        );
        assert_eq!(
            fs::read_dir(&root).unwrap().count(),
            BACKUP_JSON_FILES.len() + 1
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn import_without_local_ai_config_fills_an_empty_key() {
        let root = temp_root();
        let mut value = minimal_backup_json(AI_CONFIG_FILE);
        value.as_object_mut().unwrap().remove("api_key");
        let bytes = serde_json::to_vec(&value).unwrap();
        let zip = backup(&[(AI_CONFIG_FILE, &bytes)]);
        assert_eq!(
            import_data_at(&root, zip, crate::storage::write_bytes_atomic).unwrap(),
            (1, 0)
        );
        let restored: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(AI_CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(restored["api_key"], "");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn import_with_damaged_local_ai_config_changes_no_files() {
        let root = temp_root();
        fs::write(root.join(AI_CONFIG_FILE), b"{damaged-local-secret").unwrap();
        let before = disk_snapshot(&root);
        let mut value = minimal_backup_json(AI_CONFIG_FILE);
        value.as_object_mut().unwrap().remove("api_key");
        let bytes = serde_json::to_vec(&value).unwrap();
        let zip = backup(&[
            (FAVORITES_FILE, br#"{"version":1,"items":[]}"#),
            (AI_CONFIG_FILE, &bytes),
        ]);
        let error = import_data_at(&root, zip, crate::storage::write_bytes_atomic).unwrap_err();
        assert!(error.starts_with("本机 AI 配置格式损坏："));
        assert!(!error.contains("damaged-local-secret"));
        assert_eq!(disk_snapshot(&root), before);
        fs::remove_dir_all(root).unwrap();
    }
}
