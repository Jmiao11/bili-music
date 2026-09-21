use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const MINI_WINDOW_LABEL: &str = "mini";
const MAIN_WINDOW_LABEL: &str = "main";
const MINI_WINDOW_WIDTH: f64 = 320.0;
const MINI_WINDOW_HEIGHT: f64 = 92.0;

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is unavailable".to_owned())
}

fn mini_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MINI_WINDOW_LABEL)
        .ok_or_else(|| "mini player window is unavailable".to_owned())
}

fn initial_mini_position(main: &WebviewWindow) -> Option<(f64, f64)> {
    let scale_factor = main.scale_factor().ok()?;
    let main_position = main.outer_position().ok()?.to_logical::<f64>(scale_factor);
    let main_size = main.outer_size().ok()?.to_logical::<f64>(scale_factor);
    Some((
        main_position.x + main_size.width - MINI_WINDOW_WIDTH - 24.0,
        main_position.y + main_size.height - MINI_WINDOW_HEIGHT - 48.0,
    ))
}

#[tauri::command]
pub async fn open_mini_player(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(MINI_WINDOW_LABEL) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let builder =
        WebviewWindowBuilder::new(&app, MINI_WINDOW_LABEL, WebviewUrl::App("mini.html".into()))
            .title("Bili Music Mini")
            .inner_size(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .visible(false);

    #[cfg(target_os = "windows")]
    let builder = builder.skip_taskbar(true).shadow(true).transparent(true);

    let builder = if let Some((x, y)) = main_window(&app)
        .ok()
        .and_then(|main| initial_mini_position(&main))
    {
        builder.position(x, y)
    } else {
        builder
    };

    builder
        .build()
        .map_err(|error| format!("failed to create mini player window: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn mini_player_ready(app: AppHandle) -> Result<(), String> {
    let mini = mini_window(&app)?;
    let main = main_window(&app)?;
    mini.show().map_err(|error| error.to_string())?;
    mini.set_focus().map_err(|error| error.to_string())?;
    main.hide().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn restore_main_window(app: &AppHandle) -> Result<(), String> {
    let main = main_window(app)?;
    let _ = main.unminimize();
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn exit_mini_player(app: AppHandle) -> Result<(), String> {
    restore_main_window(&app)?;
    if let Some(mini) = app.get_webview_window(MINI_WINDOW_LABEL) {
        mini.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}
