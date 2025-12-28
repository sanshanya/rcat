use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::window_state::WindowStateStore;
use crate::EVT_CLICK_THROUGH_STATE;

// TODO: Refactor tray state management into a dedicated TrayState struct
// when tray logic grows more complex (e.g., more menu items, dynamic state).
pub(crate) fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let click_through = CheckMenuItem::with_id(
        app,
        "click_through",
        "点击穿透 (只看不用)",
        true,
        false,
        None::<&str>,
    )?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&click_through, &sep, &quit_i])?;
    let icon = app.default_window_icon().cloned();

    let click_through_for_menu = click_through.clone();
    let click_through_for_tray = click_through.clone();
    let is_through = Arc::new(AtomicBool::new(false));

    let is_through_menu = is_through.clone();
    let is_through_tray = is_through.clone();

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();

            if id == "quit" {
                let window_state = app.state::<WindowStateStore>();
                window_state.flush(app);
                app.exit(0);
                return;
            }

            if id == "click_through" {
                let current = is_through_menu.load(Ordering::SeqCst);
                let new_state = !current;
                is_through_menu.store(new_state, Ordering::SeqCst);

                let _ = click_through_for_menu.set_checked(new_state);

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_ignore_cursor_events(new_state);
                    let _ = window.set_focusable(!new_state);

                    let _ = window.emit(EVT_CLICK_THROUGH_STATE, new_state);
                }
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.is_visible().and_then(|is_visible| {
                        if is_visible {
                            window.hide()?;
                        } else {
                            window.show()?;
                            window.set_focus()?;

                            let saved_state = is_through_tray.load(Ordering::SeqCst);

                            let _ = click_through_for_tray.set_checked(saved_state);
                            let _ = window.set_ignore_cursor_events(saved_state);
                            let _ = window.set_focusable(!saved_state);

                            let _ = window.emit(EVT_CLICK_THROUGH_STATE, saved_state);
                        }
                        Ok(())
                    });
                }
            }
        });

    if let Some(i) = icon {
        builder = builder.icon(i);
    }

    builder.build(app)?;
    Ok(())
}

