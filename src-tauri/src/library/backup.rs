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
        crate::storage::write(guard, path, bytes)
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
            let _json: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("备份条目 {name} 的 JSON 格式损坏：{error}"))?;
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
            }
        }
    }
    Ok(())
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
            (FAVORITES_FILE, b"{}"),
            ("surprise.json", b"{}"),
            ("nested/playlists.json", b"{}"),
            ("background.png", b"image"),
        ]);
        assert_eq!(
            import_data_at(&root, zip, |_guard, path, bytes| fs::write(path, bytes)).unwrap(),
            (2, 2)
        );
        assert_eq!(fs::read(root.join(FAVORITES_FILE)).unwrap(), b"{}");
        assert!(!root.join("surprise.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_json_rejects_entire_backup_before_writing() {
        let root = temp_root();
        fs::write(root.join(FAVORITES_FILE), b"old").unwrap();
        let zip = backup(&[(FAVORITES_FILE, b"{}"), (PLAYLISTS_FILE, b"invalid")]);
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
        let zip = backup(&[(FAVORITES_FILE, b"{}"), (PLAYLISTS_FILE, b"{}")]);
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
}
