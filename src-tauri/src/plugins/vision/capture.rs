use image::DynamicImage;

use super::types::WindowInfo;

/// Apps to exclude from the window list (system/AI windows)
const SKIP_APPS: &[&str] = &[
    "rcat",       // Our AI app
    "app",        // Our AI app (dev build name)
    "explorer",   // File Explorer (usually desktop)
    "SearchHost", // Windows Search
    "StartMenuExperienceHost",
    "ShellExperienceHost",
    "TextInputHost",
];

/// Window titles to exclude
const SKIP_TITLES: &[&str] = &[
    "Program Manager",
    "Windows Input Experience",
    "Microsoft Text Input Application",
    "Task View",
    "Start",
    "System Tray",
    "Notification Area",
    "Action Center",
    "Desktop",
];

fn should_skip_window(app_name: &str, title: &str) -> bool {
    let app_lower = app_name.to_lowercase();
    let title_lower = title.to_lowercase();

    if SKIP_APPS
        .iter()
        .any(|&s| app_lower.contains(&s.to_lowercase()))
    {
        return true;
    }

    if SKIP_TITLES
        .iter()
        .any(|&s| title_lower.contains(&s.to_lowercase()))
    {
        return true;
    }

    title.trim().is_empty()
}

/// Capture the entire primary screen using xcap.
pub(crate) fn capture_screen() -> Result<DynamicImage, String> {
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| format!("Failed to enumerate monitors: {}", e))?;

    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| Monitor::all().ok()?.into_iter().next())
        .ok_or_else(|| "No monitors found".to_string())?;

    let buffer = primary
        .capture_image()
        .map_err(|e| format!("Failed to capture screen: {}", e))?;

    Ok(DynamicImage::ImageRgba8(buffer))
}

/// Capture a specific window by name pattern.
pub(crate) fn capture_window(name_pattern: &str) -> Result<(DynamicImage, String), String> {
    use xcap::Window;

    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;
    let pattern_lower = name_pattern.to_lowercase();

    let target = windows
        .into_iter()
        .find(|w| {
            w.title()
                .map(|t| t.to_lowercase().contains(&pattern_lower))
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("No window matching '{}' found", name_pattern))?;

    let window_name = target.title().unwrap_or_default().to_string();

    let buffer = target
        .capture_image()
        .map_err(|e| format!("Failed to capture window '{}': {}", window_name, e))?;

    Ok((DynamicImage::ImageRgba8(buffer), window_name))
}

/// Get a list of visible windows with detailed metadata, sorted by Z-order.
///
/// Windows are returned in Z-order (topmost first), excluding:
/// - AI app windows (rcat/app)
/// - System windows (Program Manager, TaskBar, etc.)
/// - Minimized windows
pub(crate) fn list_capturable_windows() -> Result<Vec<WindowInfo>, String> {
    use xcap::Window;

    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;

    let window_infos: Vec<WindowInfo> = windows
        .into_iter()
        .enumerate()
        .filter_map(|(idx, w)| {
            let title = w.title().ok()?;
            let app_name = w.app_name().unwrap_or_default();
            let is_minimized = w.is_minimized().unwrap_or(false);

            if is_minimized {
                return None;
            }

            if should_skip_window(&app_name, &title) {
                return None;
            }

            Some(WindowInfo {
                title,
                app_name,
                pid: w.pid().unwrap_or(0),
                is_focused: w.is_focused().unwrap_or(false),
                z_index: idx,
                is_minimized,
            })
        })
        .collect();

    Ok(window_infos)
}

/// Get the "smart" target window - the most relevant window for AI to observe.
///
/// Selection priority:
/// 1. The currently focused window (if not our AI window)
/// 2. The topmost non-AI window in Z-order
pub(crate) fn get_smart_window() -> Result<Option<WindowInfo>, String> {
    let windows = list_capturable_windows()?;

    if let Some(focused) = windows.iter().find(|w| w.is_focused) {
        return Ok(Some(focused.clone()));
    }

    Ok(windows.into_iter().next())
}

pub(crate) fn capture_smart_image() -> Result<(DynamicImage, String), String> {
    use xcap::Window;

    let target_info = get_smart_window()?
        .ok_or_else(|| "No suitable window found to capture".to_string())?;

    let windows = Window::all().map_err(|e| format!("Failed to enumerate windows: {}", e))?;

    let target = windows
        .into_iter()
        .find(|w| {
            w.pid().unwrap_or(0) == target_info.pid
                && w.title().unwrap_or_default() == target_info.title
        })
        .ok_or_else(|| format!("Window '{}' no longer exists", target_info.title))?;

    let buffer = target
        .capture_image()
        .map_err(|e| format!("Failed to capture window: {}", e))?;

    Ok((DynamicImage::ImageRgba8(buffer), target_info.title))
}

