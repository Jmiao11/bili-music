//! Optional Windows global shortcuts. Playback remains owned by the frontend.

pub use platform::{install, reload};

#[cfg(not(windows))]
mod platform {
    pub fn install(_app: &tauri::App) {}

    pub fn reload(_app: &tauri::AppHandle) {}
}

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    static ACTIONS: OnceLock<Mutex<HashMap<u32, &'static str>>> = OnceLock::new();

    fn actions() -> &'static Mutex<HashMap<u32, &'static str>> {
        ACTIONS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    #[cfg(debug_assertions)]
    fn log(message: impl std::fmt::Display) {
        eprintln!("[shortcut] {message}");
    }

    #[cfg(not(debug_assertions))]
    fn log(_message: impl std::fmt::Display) {}

    pub fn install(app: &tauri::App) {
        let plugin = tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let action = actions()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .get(&shortcut.id())
                    .copied();
                if let Some(action) = action {
                    if let Err(error) = app.emit("global-shortcut", action) {
                        log(format_args!("cannot emit {action}: {error}"));
                    }
                }
            })
            .build();
        if let Err(error) = app.handle().plugin(plugin) {
            log(format_args!("cannot install plugin: {error}"));
            return;
        }
        reload(app.handle());
    }

    pub fn reload(app: &tauri::AppHandle) {
        let manager = app.global_shortcut();
        if let Err(error) = manager.unregister_all() {
            log(format_args!("cannot unregister shortcuts: {error}"));
        }
        actions()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();

        let shortcuts = match crate::library::get_shortcuts() {
            Ok(shortcuts) => shortcuts,
            Err(error) => {
                log(format_args!("cannot read shortcuts.json: {error}"));
                return;
            }
        };
        for (action, binding) in shortcuts.bindings.entries() {
            let Some(binding) = binding else {
                continue;
            };
            let shortcut = match binding.parse::<Shortcut>() {
                Ok(shortcut) => shortcut,
                Err(error) => {
                    log(format_args!(
                        "invalid {action} binding {binding:?}: {error}"
                    ));
                    continue;
                }
            };
            if let Err(error) = manager.register(shortcut) {
                log(format_args!(
                    "cannot register {action} as {binding:?}: {error}"
                ));
                continue;
            }
            actions()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(shortcut.id(), action);
        }
    }
}
