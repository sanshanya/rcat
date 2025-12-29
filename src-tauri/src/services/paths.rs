use std::path::PathBuf;
use std::sync::OnceLock;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

const SAVEDATA_DIR_NAME: &str = "savedata";

fn exe_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent().map(|p| p.to_path_buf())
}

/// Resolve and create the application's data directory.
///
/// Single source of truth:
/// - `<exe_dir>/savedata`
pub(crate) fn init_data_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = DATA_DIR.get() {
        return Ok(dir.clone());
    }

    let dir = exe_dir()
        .ok_or_else(|| "Failed to resolve executable directory".to_string())?
        .join(SAVEDATA_DIR_NAME);

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data directory: {e}"))?;
    let _ = DATA_DIR.set(dir.clone());
    Ok(dir)
}

pub(crate) fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = DATA_DIR.get() {
        return Ok(dir.clone());
    }
    init_data_dir(app)
}

pub(crate) fn data_dir_cached() -> Option<PathBuf> {
    DATA_DIR.get().cloned()
}
