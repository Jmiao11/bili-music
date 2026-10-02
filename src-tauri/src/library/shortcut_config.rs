use super::{
    library_file_path, read_json_or_default, write_json_atomic, Versioned, SHORTCUTS_FILE, VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindings {
    pub previous: Option<String>,
    pub play_pause: Option<String>,
    pub next: Option<String>,
    pub volume_up: Option<String>,
    pub volume_down: Option<String>,
}

impl ShortcutBindings {
    pub(crate) fn entries(&self) -> [(&'static str, Option<&str>); 5] {
        [
            ("previous", self.previous.as_deref()),
            ("play_pause", self.play_pause.as_deref()),
            ("next", self.next.as_deref()),
            ("volume_up", self.volume_up.as_deref()),
            ("volume_down", self.volume_down.as_deref()),
        ]
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Shortcuts {
    version: u32,
    pub bindings: ShortcutBindings,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            version: VERSION,
            bindings: ShortcutBindings::default(),
        }
    }
}

#[tauri::command]
pub fn get_shortcuts() -> Result<Shortcuts, String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    let shortcuts: Shortcuts = read_json_or_default(guard, &shortcuts_path(guard)?)?;
    validate_shortcut_bindings(&shortcuts.bindings)?;
    Ok(shortcuts)
}

#[tauri::command]
pub fn set_shortcuts(app: tauri::AppHandle, bindings: ShortcutBindings) -> Result<(), String> {
    let storage_guard = crate::storage::lock_storage()?;
    let guard = &storage_guard;
    validate_shortcut_bindings(&bindings)?;
    write_json_atomic(
        guard,
        &shortcuts_path(guard)?,
        &Shortcuts {
            version: VERSION,
            bindings,
        },
    )?;
    drop(storage_guard);
    crate::shortcuts::reload(&app);
    Ok(())
}

impl Versioned for Shortcuts {
    fn version(&self) -> u32 {
        self.version
    }
}

fn validate_shortcut_bindings(bindings: &ShortcutBindings) -> Result<(), String> {
    let mut seen = HashSet::new();
    for (action, binding) in bindings.entries() {
        let Some(binding) = binding else {
            continue;
        };
        if binding.trim().is_empty() {
            return Err(format!("{action} shortcut must be null instead of empty"));
        }
        let normalized = normalize_shortcut(binding)
            .ok_or_else(|| format!("invalid shortcut for {action}: {binding}"))?;
        if !seen.insert(normalized) {
            return Err(format!("duplicate shortcut binding: {binding}"));
        }
    }
    Ok(())
}

fn normalize_shortcut(value: &str) -> Option<String> {
    let tokens = value.split('+').map(str::trim).collect::<Vec<_>>();
    if tokens.is_empty() || tokens.len() > 5 || tokens.iter().any(|token| token.is_empty()) {
        return None;
    }

    let mut modifiers = Vec::new();
    for token in &tokens[..tokens.len() - 1] {
        let modifier = match token.to_ascii_uppercase().as_str() {
            "ALT" | "OPTION" => "ALT",
            "CONTROL" | "CTRL" => "CONTROL",
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => {
                if cfg!(target_os = "macos") {
                    "SUPER"
                } else {
                    "CONTROL"
                }
            }
            "COMMAND" | "CMD" | "SUPER" => "SUPER",
            "SHIFT" => "SHIFT",
            _ => return None,
        };
        if modifiers.contains(&modifier) {
            return None;
        }
        modifiers.push(modifier);
    }

    let key = normalize_shortcut_key(tokens[tokens.len() - 1])?;
    modifiers.sort_unstable();
    modifiers.push(&key);
    Some(modifiers.join("+"))
}

fn normalize_shortcut_key(value: &str) -> Option<String> {
    let key = value.to_ascii_uppercase();
    let key = match key.as_str() {
        key if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => key.to_owned(),
        key if key.len() == 4
            && key.starts_with("KEY")
            && key.as_bytes()[3].is_ascii_alphabetic() =>
        {
            key[3..].to_owned()
        }
        key if key.len() == 6 && key.starts_with("DIGIT") && key.as_bytes()[5].is_ascii_digit() => {
            key[5..].to_owned()
        }
        "ARROWLEFT" | "LEFT" => "LEFT".to_owned(),
        "ARROWRIGHT" | "RIGHT" => "RIGHT".to_owned(),
        "ARROWUP" | "UP" => "UP".to_owned(),
        "ARROWDOWN" | "DOWN" => "DOWN".to_owned(),
        key if key
            .strip_prefix('F')
            .and_then(|number| number.parse::<u8>().ok())
            .is_some_and(|number| (1..=24).contains(&number)) =>
        {
            key.to_owned()
        }
        "BACKQUOTE" | "BACKSLASH" | "BRACKETLEFT" | "BRACKETRIGHT" | "PAUSE" | "PAUSEBREAK"
        | "COMMA" | "EQUAL" | "MINUS" | "PERIOD" | "QUOTE" | "SEMICOLON" | "SLASH"
        | "BACKSPACE" | "CAPSLOCK" | "ENTER" | "SPACE" | "TAB" | "DELETE" | "END" | "HOME"
        | "INSERT" | "PAGEDOWN" | "PAGEUP" | "PRINTSCREEN" | "SCROLLLOCK" | "NUMLOCK"
        | "ESCAPE" | "ESC" | "AUDIOVOLUMEDOWN" | "VOLUMEDOWN" | "AUDIOVOLUMEUP" | "VOLUMEUP"
        | "AUDIOVOLUMEMUTE" | "VOLUMEMUTE" | "MEDIAPLAY" | "MEDIAPAUSE" | "MEDIAPLAYPAUSE"
        | "MEDIASTOP" | "MEDIATRACKNEXT" | "MEDIATRACKPREV" | "MEDIATRACKPREVIOUS" => key,
        key if key
            .strip_prefix("NUMPAD")
            .or_else(|| key.strip_prefix("NUM"))
            .is_some_and(|suffix| {
                matches!(
                    suffix,
                    "0" | "1"
                        | "2"
                        | "3"
                        | "4"
                        | "5"
                        | "6"
                        | "7"
                        | "8"
                        | "9"
                        | "ADD"
                        | "PLUS"
                        | "DECIMAL"
                        | "DIVIDE"
                        | "ENTER"
                        | "EQUAL"
                        | "MULTIPLY"
                        | "SUBTRACT"
                )
            }) =>
        {
            key.to_owned()
        }
        _ => return None,
    };
    Some(key)
}

fn shortcuts_path(guard: &crate::storage::StorageGuard) -> Result<PathBuf, String> {
    library_file_path(guard, SHORTCUTS_FILE)
}

pub(super) fn validate_import_json(file_name: &str, bytes: &[u8]) -> Result<(), String> {
    super::validate_json_bytes::<Shortcuts>(file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::test_path;
    use super::*;
    use std::fs;

    #[test]
    fn shortcuts_default_to_all_unbound() {
        assert_eq!(Shortcuts::default().bindings, ShortcutBindings::default());
    }

    #[test]
    fn shortcuts_round_trip() {
        let path = test_path();
        let shortcuts = Shortcuts {
            version: VERSION,
            bindings: ShortcutBindings {
                previous: Some("Ctrl+Alt+Left".to_owned()),
                play_pause: Some("Ctrl+Alt+Space".to_owned()),
                ..Default::default()
            },
        };
        write_json_atomic(&crate::storage::lock_storage().unwrap(), &path, &shortcuts).unwrap();
        assert_eq!(
            read_json_or_default::<Shortcuts>(&crate::storage::lock_storage().unwrap(), &path)
                .unwrap(),
            shortcuts
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn shortcuts_reject_unsupported_version() {
        let path = test_path();
        fs::write(&path, r#"{"version":999,"bindings":{}}"#).unwrap();
        assert!(
            read_json_or_default::<Shortcuts>(&crate::storage::lock_storage().unwrap(), &path)
                .unwrap_err()
                .contains("999")
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn shortcut_validation_rejects_empty_strings() {
        let bindings = ShortcutBindings {
            previous: Some("  ".to_owned()),
            ..Default::default()
        };
        assert!(validate_shortcut_bindings(&bindings).is_err());
    }

    #[test]
    fn shortcut_validation_rejects_duplicate_bindings() {
        let bindings = ShortcutBindings {
            previous: Some("Ctrl+Alt+Left".to_owned()),
            next: Some("alt+control+ArrowLeft".to_owned()),
            ..Default::default()
        };
        assert!(validate_shortcut_bindings(&bindings).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn shortcut_validation_treats_command_or_control_as_command_on_macos() {
        let bindings = ShortcutBindings {
            previous: Some("CommandOrControl+P".to_owned()),
            next: Some("Command+P".to_owned()),
            ..Default::default()
        };
        assert!(validate_shortcut_bindings(&bindings).is_err());
    }

    #[test]
    fn shortcut_validation_accepts_legal_combinations_and_nulls() {
        let bindings = ShortcutBindings {
            previous: Some("Ctrl+Alt+Left".to_owned()),
            play_pause: Some("Ctrl+Alt+Space".to_owned()),
            next: Some("Ctrl+Alt+Right".to_owned()),
            volume_up: Some("Ctrl+Alt+Up".to_owned()),
            volume_down: None,
        };
        assert_eq!(validate_shortcut_bindings(&bindings), Ok(()));
    }
}
