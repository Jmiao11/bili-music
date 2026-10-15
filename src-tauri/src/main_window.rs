use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const STARTUP_TIMEOUT_MS: u64 = 5000;
const STARTUP_LOG_MAX_CHARS: usize = 1024;

#[derive(Default)]
pub(crate) struct ReadyGate {
    completed: bool,
}

impl ReadyGate {
    fn mark_ready<E>(&mut self, show: impl FnOnce() -> Result<(), E>) -> Result<bool, E> {
        if self.completed {
            return Ok(false);
        }
        show()?;
        self.completed = true;
        Ok(true)
    }

    fn on_timeout<E>(&mut self, show: impl FnOnce() -> Result<(), E>) -> Result<bool, E> {
        self.mark_ready(show)
    }
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_owned())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn main_window_ready(app: AppHandle, gate: State<'_, Mutex<ReadyGate>>) -> Result<(), String> {
    let result = gate
        .lock()
        .map_err(|_| "main window ready gate is poisoned".to_owned())?
        .mark_ready(|| show_main_window(&app));
    result
        .map(|_| ())
        .map_err(|error| report_startup_error(&app, "ready show failed", Some(&error)))
}

pub(crate) fn install_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(STARTUP_TIMEOUT_MS)).await;
        let gate = app.state::<Mutex<ReadyGate>>();
        let result = gate
            .lock()
            .map_err(|_| "main window ready gate is poisoned".to_owned())
            .and_then(|mut gate| {
                gate.on_timeout(|| {
                    report_startup_error(&app, &format!("startup timed out after {STARTUP_TIMEOUT_MS} ms: no successful main_window_ready handshake"), None);
                    show_main_window(&app)
                })
            });
        if let Err(error) = result {
            report_startup_error(&app, "watchdog show failed", Some(&error));
        }
    });
}

fn startup_error_message(context: &str, detail: Option<&str>) -> String {
    // No startup API key is available: redact opaque error details in full.
    let detail = detail.map(|error| crate::ai::safe_error(error, error));
    format!(
        "[main-window] {context}{}",
        detail.map(|error| format!(": {error}")).unwrap_or_default()
    )
    .chars()
    .take(STARTUP_LOG_MAX_CHARS)
    .collect()
}

fn startup_log_root() -> Result<std::path::PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        crate::library::library_root()
    }
    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .map_err(|error| error.to_string())?
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| "executable directory is unavailable".to_owned())
    }
}

fn report_startup_error(app: &AppHandle, context: &str, detail: Option<&str>) -> String {
    let message = startup_error_message(context, detail);
    eprintln!("{message}");
    let saved = startup_log_root().and_then(|root| write_startup_error(&root, context, detail));
    if let Err(error) = saved {
        eprintln!(
            "{}",
            startup_error_message("cannot write startup-errors.log", Some(&error))
        );
    }
    if let Some(main) = app.get_webview_window("main") {
        let literal = serde_json::json!(message).to_string();
        let _ = main.eval(format!(
            "window.recordPlaybackDiag?.('startup', {literal}); console.error({literal});"
        ));
    }
    message
}

fn write_startup_error(
    root: &std::path::Path,
    context: &str,
    detail: Option<&str>,
) -> Result<(), String> {
    let guard = crate::storage::lock_storage()?;
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let path = root.join("startup-errors.log");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let message = startup_error_message(context, detail);
    crate::storage::write_bytes_atomic(&guard, &path, format!("{timestamp} {message}\n").as_bytes())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::ReadyGate;

    #[test]
    fn startup_errors_redact_sensitive_details_and_replace_the_previous_bounded_record() {
        let root = std::env::temp_dir().join(format!("bili-startup-log-{}", uuid::Uuid::new_v4()));
        let secrets = "https://example.invalid/audio?oi=123&token=secret Cookie: SESSDATA=login; buvid3=visitor; b_nut=identity; API Key: sk-secret-key";
        super::write_startup_error(&root, "ready show failed", Some(secrets)).unwrap();
        let text = std::fs::read_to_string(root.join("startup-errors.log")).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].ends_with(" [main-window] ready show failed: [redacted]"));
        for secret in [
            secrets,
            "https://",
            "oi=",
            "Cookie",
            "SESSDATA",
            "buvid3",
            "b_nut",
            "sk-secret-key",
        ] {
            assert!(!text.contains(secret));
        }
        assert!(lines
            .iter()
            .all(|line| line.split_once(' ').unwrap().0.parse::<u128>().is_ok()));
        super::write_startup_error(&root, &"x".repeat(100_000), None).unwrap();
        assert!(
            std::fs::metadata(root.join("startup-errors.log"))
                .unwrap()
                .len()
                <= 4 * super::STARTUP_LOG_MAX_CHARS as u64 + 32
        );
        super::write_startup_error(&root, "watchdog timeout", None).unwrap();
        let latest = std::fs::read_to_string(root.join("startup-errors.log")).unwrap();
        assert_eq!(latest.lines().count(), 1);
        assert!(latest.ends_with(" [main-window] watchdog timeout\n"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ready_then_timeout_shows_only_once() {
        let mut gate = ReadyGate::default();
        let mut shows = 0;
        assert_eq!(
            gate.mark_ready(|| {
                shows += 1;
                Ok::<_, ()>(())
            }),
            Ok(true)
        );
        assert_eq!(
            gate.on_timeout(|| {
                shows += 1;
                Ok::<_, ()>(())
            }),
            Ok(false)
        );
        assert_eq!(shows, 1);
    }

    #[test]
    fn timeout_then_ready_shows_only_once() {
        let mut gate = ReadyGate::default();
        let mut shows = 0;
        assert_eq!(
            gate.on_timeout(|| {
                shows += 1;
                Ok::<_, ()>(())
            }),
            Ok(true)
        );
        assert_eq!(
            gate.mark_ready(|| {
                shows += 1;
                Ok::<_, ()>(())
            }),
            Ok(false)
        );
        assert_eq!(shows, 1);
    }

    #[test]
    fn repeated_ready_does_not_show_again() {
        let mut gate = ReadyGate::default();
        assert_eq!(gate.mark_ready(|| Ok::<_, ()>(())), Ok(true));
        assert_eq!(
            gate.mark_ready(|| panic!("must not show twice")),
            Ok::<_, ()>(false)
        );
    }

    #[test]
    fn failed_show_does_not_complete_gate() {
        let mut gate = ReadyGate::default();
        assert_eq!(
            gate.mark_ready(|| Err::<(), _>("show failed")),
            Err("show failed")
        );
        assert!(!gate.completed);
        assert_eq!(
            gate.on_timeout(|| Err::<(), _>("still failed")),
            Err("still failed")
        );
        assert!(!gate.completed);
        assert_eq!(gate.mark_ready(|| Ok::<_, &str>(())), Ok(true));
    }
}
