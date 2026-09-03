//! Optional Windows thumbnail controls. Playback remains owned by the frontend.

pub use platform::install;

#[tauri::command]
pub fn set_taskbar_playback_state(app: tauri::AppHandle, is_playing: bool) {
    platform::set_playback_state(app, is_playing);
}

#[cfg(not(windows))]
mod platform {
    pub fn install(_app: &tauri::App) {}

    pub fn set_playback_state(_app: tauri::AppHandle, _is_playing: bool) {}
}

#[cfg(any(windows, test))]
mod icons {
    pub const PLAY: &[u8] = include_bytes!("../icons/play.ico");
    pub const PAUSE: &[u8] = include_bytes!("../icons/pause.ico");
    pub const PREVIOUS: &[u8] = include_bytes!("../icons/previous.ico");
    pub const NEXT: &[u8] = include_bytes!("../icons/next.ico");

    // An ICO file has a directory, unlike the RT_ICON bytes accepted by Win32.
    // Prefer the smallest frame at least as large as requested, then the largest.
    pub fn image_data(ico: &[u8], size: u32) -> Option<&[u8]> {
        if ico.get(..4)? != [0, 0, 1, 0] {
            return None;
        }
        let count = u16::from_le_bytes(ico.get(4..6)?.try_into().ok()?) as usize;
        let directory_end = 6 + count * 16;
        let directory = ico.get(6..directory_end)?;
        let entry = directory.chunks_exact(16).min_by_key(|entry| {
            let width = if entry[0] == 0 {
                256
            } else {
                u32::from(entry[0])
            };
            (width < size, width.abs_diff(size))
        })?;
        let length = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        let offset = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        if offset < directory_end || length == 0 {
            return None;
        }
        ico.get(offset..offset.checked_add(length)?)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn embedded_icons_have_white_transparent_frames_at_required_sizes() {
            for ico in [PLAY, PAUSE, PREVIOUS, NEXT] {
                for size in [16, 20, 24, 32, 40, 48, 64] {
                    let image = image::load_from_memory(image_data(ico, size).unwrap())
                        .unwrap()
                        .to_rgba8();
                    assert_eq!(image.dimensions(), (size, size));
                    assert!(image.pixels().any(|p| p[3] == 0));
                    assert!(image.pixels().any(|p| p[3] == 255));
                    assert!(image.pixels().all(|p| p[3] == 0 || p.0[..3] == [255; 3]));
                }
            }
            let selected = image::load_from_memory(image_data(PLAY, 21).unwrap()).unwrap();
            assert_eq!(selected.width(), 24);
            let selected = image::load_from_memory(image_data(PLAY, 96).unwrap()).unwrap();
            assert_eq!(selected.width(), 64);
        }

        #[test]
        fn invalid_icon_directories_do_not_reach_the_native_decoder() {
            assert!(image_data(&[], 16).is_none());
            assert!(image_data(&[0, 0, 1, 0, 0, 0], 16).is_none());
            assert!(image_data(&PLAY[..20], 16).is_none());
            let mut invalid = PLAY.to_vec();
            invalid[18..22].copy_from_slice(&u32::MAX.to_le_bytes());
            assert!(image_data(&invalid, 16).is_none());
            invalid[18..22].copy_from_slice(&0_u32.to_le_bytes());
            assert!(image_data(&invalid, 16).is_none());
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::icons;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use tauri::{Emitter, Manager};
    use windows::core::{w, Error, Result, PCWSTR};
    use windows::Win32::Foundation::{E_INVALIDARG, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Diagnostics::Debug::OutputDebugStringW;
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList,
        THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, DestroyIcon, RegisterWindowMessageW, HICON, LR_DEFAULTCOLOR,
        SM_CXSMICON, WM_COMMAND, WM_NCDESTROY,
    };

    const SUBCLASS_ID: usize = 0x424d5442;
    const PREVIOUS_ID: u32 = 0x7101;
    const PLAY_PAUSE_ID: u32 = 0x7102;
    const NEXT_ID: u32 = 0x7103;
    const MAX_ADD_RETRIES: u8 = 3;

    fn log(message: impl std::fmt::Display) {
        let message = format!("[taskbar] {message}");
        let wide: Vec<u16> = message.encode_utf16().chain([10, 0]).collect();
        unsafe {
            OutputDebugStringW(PCWSTR(wide.as_ptr()));
        }
        eprintln!("{message}");
    }

    fn log_failure<T>(step: &str, result: Result<T>) -> Result<T> {
        result.inspect_err(|error| log(format_args!("{step} failed: {error}")))
    }

    #[derive(Default)]
    struct AddState {
        added: Cell<bool>,
        in_progress: Cell<bool>,
        failures: Cell<u8>,
        taskbar_created: Cell<bool>,
    }

    impl AddState {
        fn begin(&self) -> bool {
            // COM can pump messages. Keep a reentrant creation message pending.
            if self.in_progress.get() {
                return false;
            }
            if self.taskbar_created.replace(false) && self.added.replace(false) {
                // A new taskbar button invalidates the previously added toolbar.
                self.failures.set(0);
            }
            if self.added.get() || self.failures.get() > MAX_ADD_RETRIES {
                return false;
            }
            self.in_progress.set(true);
            true
        }

        fn finish(&self, success: bool) {
            self.added.set(success);
            if success {
                self.failures.set(0);
            } else {
                self.failures.set(self.failures.get() + 1);
            }
            self.in_progress.set(false);
        }
    }

    // Only the main window has a toolbar. No native pointer is kept in dwRefData
    // or sent to worker threads. Rc also keeps reentrant COM callbacks safe.
    thread_local! {
        static MAIN: RefCell<Option<Rc<WindowState>>> = const { RefCell::new(None) };
    }

    struct WindowState {
        hwnd: HWND,
        app: tauri::AppHandle,
        created_message: u32,
        alive: Cell<bool>,
        add: AddState,
        playing: Cell<bool>,
        updating: Cell<bool>,
        update_failed: Cell<bool>,
        // Some means ThumbBarAddButtons has succeeded; only Update is legal now.
        toolbar: RefCell<Option<Rc<Toolbar>>>,
    }

    struct OwnedIcon(HICON);

    impl OwnedIcon {
        fn load(bytes: &[u8], size: i32) -> Result<Self> {
            let frame = icons::image_data(bytes, size as u32)
                .ok_or_else(|| Error::new(E_INVALIDARG, "invalid embedded ICO"))?;
            // CreateIconFromResourceEx requires DWORD-aligned resource bytes;
            // include_bytes! and an ICO directory offset do not guarantee that.
            let mut aligned = vec![0_u32; frame.len().div_ceil(4)];
            let resource = unsafe {
                std::slice::from_raw_parts_mut(aligned.as_mut_ptr().cast::<u8>(), frame.len())
            };
            resource.copy_from_slice(frame);
            // Each embedded ICO frame is a PNG RT_ICON payload, not an ICO header.
            unsafe {
                CreateIconFromResourceEx(resource, true, 0x00030000, size, size, LR_DEFAULTCOLOR)
            }
            .map(Self)
        }
    }

    impl Drop for OwnedIcon {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyIcon(self.0);
            }
        }
    }

    struct ComApartment;

    impl ComApartment {
        fn initialize() -> Result<Self> {
            // Both S_OK and S_FALSE add a COM initialization reference.
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            }
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    struct Toolbar {
        api: ITaskbarList3,
        icons: [OwnedIcon; 4],
        playing: Cell<bool>,
        // Rust drops fields in declaration order: release COM objects first.
        _apartment: ComApartment,
    }

    impl Toolbar {
        fn create(hwnd: HWND) -> Result<Self> {
            let apartment = log_failure("CoInitializeEx", ComApartment::initialize())?;
            let api: ITaskbarList3 = log_failure("CoCreateInstance", unsafe {
                CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)
            })?;
            log_failure("HrInit", unsafe { api.HrInit() })?;
            let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
            let size = unsafe { GetSystemMetricsForDpi(SM_CXSMICON, dpi) }.max(16);
            Ok(Self {
                api,
                icons: [
                    log_failure("load previous.ico", OwnedIcon::load(icons::PREVIOUS, size))?,
                    log_failure("load play.ico", OwnedIcon::load(icons::PLAY, size))?,
                    log_failure("load pause.ico", OwnedIcon::load(icons::PAUSE, size))?,
                    log_failure("load next.ico", OwnedIcon::load(icons::NEXT, size))?,
                ],
                playing: Cell::new(false),
                _apartment: apartment,
            })
        }

        fn play_button(&self, playing: bool) -> THUMBBUTTON {
            button(
                PLAY_PAUSE_ID,
                self.icons[if playing { 2 } else { 1 }].0,
                if playing { "暂停" } else { "播放" },
            )
        }

        fn add(&self, hwnd: HWND, playing: bool) -> Result<()> {
            let buttons = [
                button(PREVIOUS_ID, self.icons[0].0, "上一首"),
                self.play_button(playing),
                button(NEXT_ID, self.icons[3].0, "下一首"),
            ];
            log_failure("ThumbBarAddButtons", unsafe {
                self.api.ThumbBarAddButtons(hwnd, &buttons)
            })?;
            self.playing.set(playing);
            Ok(())
        }
    }

    fn button(id: u32, icon: HICON, tooltip: &str) -> THUMBBUTTON {
        let mut button = THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: id,
            hIcon: icon,
            dwFlags: THBF_ENABLED,
            ..Default::default()
        };
        for (slot, ch) in button
            .szTip
            .iter_mut()
            .take(259)
            .zip(tooltip.encode_utf16())
        {
            *slot = ch;
        }
        button
    }

    impl WindowState {
        fn taskbar_created(&self) {
            log("received TaskbarButtonCreated");
            self.add.taskbar_created.set(true);
            self.try_initialize();
        }

        fn try_initialize(&self) {
            if self.updating.get() {
                return;
            }
            while self.alive.get() && self.add.begin() {
                let previous = self.toolbar.take();
                drop(previous);
                self.update_failed.set(false);
                log(format_args!(
                    "initialization attempt {}/{}",
                    self.add.failures.get() + 1,
                    MAX_ADD_RETRIES + 1
                ));
                let result = (|| -> Result<()> {
                    let toolbar = Rc::new(Toolbar::create(self.hwnd)?);
                    if !self.alive.get() {
                        return Ok(());
                    }
                    toolbar.add(self.hwnd, self.playing.get())?;
                    if self.alive.get() {
                        self.toolbar.replace(Some(toolbar));
                        self.update();
                        log("thumbnail buttons added");
                    }
                    Ok(())
                })();
                self.add
                    .finish(result.is_ok() && self.toolbar.borrow().is_some());
                if result.is_err() && self.add.failures.get() > MAX_ADD_RETRIES {
                    log("initialization abandoned after initial attempt and 3 retries");
                }
                // Retry only for a creation message received during this attempt.
                // Otherwise a later message must trigger the next attempt.
                if !self.add.taskbar_created.get() {
                    break;
                }
            }
        }

        fn update(&self) {
            if !self.alive.get() || self.update_failed.get() || self.updating.replace(true) {
                return;
            }
            let toolbar = self.toolbar.borrow().clone();
            if let Some(toolbar) = toolbar {
                // COM may pump messages. Reentrant reports only update the Cell;
                // apply the newest value after the in-flight call finishes.
                while self.alive.get() && toolbar.playing.get() != self.playing.get() {
                    let playing = self.playing.get();
                    let result = unsafe {
                        toolbar
                            .api
                            .ThumbBarUpdateButtons(self.hwnd, &[toolbar.play_button(playing)])
                    };
                    if let Err(error) = result {
                        self.update_failed.set(true);
                        log(format_args!("ThumbBarUpdateButtons failed: {error}"));
                        break;
                    }
                    toolbar.playing.set(playing);
                }
            }
            self.updating.set(false);
            if self.add.taskbar_created.get() {
                self.try_initialize();
            }
        }
    }

    fn window_state(hwnd: HWND) -> Option<Rc<WindowState>> {
        MAIN.with(|slot| {
            slot.borrow()
                .as_ref()
                .filter(|state| state.hwnd == hwnd)
                .cloned()
        })
    }

    pub fn install(app: &tauri::App) {
        // Tauri setup runs on the window's UI thread. Do not defer installation.
        if MAIN.with(|slot| slot.borrow().is_some()) {
            return;
        }
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd,
            Err(error) => {
                log(format_args!("window handle unavailable: {error}"));
                return;
            }
        };
        let created_message = unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) };
        if created_message == 0 {
            log(format_args!(
                "cannot register TaskbarButtonCreated: {}",
                Error::from_win32()
            ));
            return;
        }
        let state = Rc::new(WindowState {
            hwnd,
            app: app.handle().clone(),
            created_message,
            alive: Cell::new(true),
            add: AddState::default(),
            playing: Cell::new(false),
            updating: Cell::new(false),
            update_failed: Cell::new(false),
            toolbar: RefCell::new(None),
        });
        MAIN.with(|slot| slot.replace(Some(state.clone())));
        if !unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) }.as_bool() {
            MAIN.with(|slot| slot.take());
            log("cannot install window subclass");
            return;
        }
        log("subclass installed; trying initialization immediately");
        state.try_initialize();
    }

    pub fn set_playback_state(app: tauri::AppHandle, is_playing: bool) {
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            // Resolve the live window at execution time, never capture a raw HWND
            // or a state pointer in a queued command that can outlive the window.
            let Some(window) = handle.get_webview_window("main") else {
                return;
            };
            let Ok(hwnd) = window.hwnd() else {
                return;
            };
            if let Some(state) = window_state(hwnd) {
                state.playing.set(is_playing);
                state.update();
            }
        }) {
            log(format_args!("cannot schedule playback state: {error}"));
        }
    }

    fn clicked_action(message: u32, wparam: WPARAM) -> Option<&'static str> {
        if message != WM_COMMAND || ((wparam.0 >> 16) & 0xffff) != THBN_CLICKED as usize {
            return None;
        }
        match (wparam.0 & 0xffff) as u32 {
            PREVIOUS_ID => Some("previous"),
            PLAY_PAUSE_ID => Some("play_pause"),
            NEXT_ID => Some("next"),
            _ => None,
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if let Some(state) = window_state(hwnd) {
            if message == WM_NCDESTROY {
                state.alive.set(false);
                if !unsafe { RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID) }
                    .as_bool()
                {
                    log("cannot remove window subclass during destruction");
                }
                MAIN.with(|slot| slot.take());
                // In-flight callbacks hold an Rc until they return; no dangling
                // dwRefData pointer even if COM reenters during destruction.
                let toolbar = state.toolbar.take();
                drop(toolbar);
            } else if message == state.created_message {
                state.taskbar_created();
            } else if let Some(action) = clicked_action(message, wparam) {
                if let Err(error) = state.app.emit("taskbar-media-control", action) {
                    log(format_args!("cannot emit media control: {error}"));
                }
                return LRESULT(0);
            }
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn initialization_retries_are_bounded_and_taskbar_recreation_allows_readding() {
            let state = AddState::default();
            for _ in 0..=MAX_ADD_RETRIES {
                assert!(state.begin());
                assert!(!state.begin()); // COM reentry cannot start a second Add.
                state.taskbar_created.set(true);
                assert!(!state.begin());
                assert!(state.taskbar_created.get()); // The message is not lost.
                state.finish(false);
                assert!(!state.added.get());
            }
            for _ in 0..10 {
                state.taskbar_created.set(true);
                assert!(!state.begin()); // Messages cannot reset a failed retry budget.
            }

            let state = AddState::default();
            assert!(state.begin());
            state.finish(false);
            state.taskbar_created.set(true);
            assert!(state.begin());
            state.finish(true);
            assert!(state.added.get());
            assert!(!state.begin()); // A successful toolbar only receives updates.
            state.taskbar_created.set(true); // Explorer recreated the taskbar button.
            assert!(state.begin());
            assert!(!state.added.get());
            assert_eq!(state.failures.get(), 0);
            state.finish(true);
            assert!(!state.begin());
        }

        #[test]
        fn only_our_thumbnail_click_notifications_are_forwarded() {
            for (id, action) in [
                (PREVIOUS_ID, "previous"),
                (PLAY_PAUSE_ID, "play_pause"),
                (NEXT_ID, "next"),
            ] {
                let click = WPARAM(((THBN_CLICKED as usize) << 16) | id as usize);
                assert_eq!(clicked_action(WM_COMMAND, click), Some(action));
                assert_eq!(clicked_action(WM_NCDESTROY, click), None);
                assert_eq!(clicked_action(WM_COMMAND, WPARAM(id as usize)), None);
            }
            assert_eq!(
                clicked_action(WM_COMMAND, WPARAM((THBN_CLICKED as usize) << 16)),
                None
            );
        }

        #[test]
        fn embedded_frames_create_owned_native_icons() {
            for bytes in [icons::PLAY, icons::PAUSE, icons::PREVIOUS, icons::NEXT] {
                for size in [16, 20, 24, 32, 40, 48, 64] {
                    let icon = OwnedIcon::load(bytes, size).unwrap();
                    assert!(!icon.0.is_invalid());
                    // Drop calls DestroyIcon, including if a later assertion fails.
                }
            }
        }
    }
}
