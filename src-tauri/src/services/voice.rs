use log::{debug, error, info, warn};
use rcat_voice::generator::{build_from_env, TtsEngine};
use rcat_voice::streaming::StreamCancelHandle;
use std::sync::{Arc, Mutex, Weak};
#[cfg(target_os = "windows")]
use std::sync::OnceLock;
use tokio::sync::Mutex as AsyncMutex;

pub struct VoiceState {
    engine: Mutex<VoiceEngineState>,
    speak_lock: AsyncMutex<()>,
    stream: AsyncMutex<Option<StreamCancelHandle>>,
}

#[derive(Default)]
struct VoiceEngineState {
    cached: Option<Arc<dyn TtsEngine>>,
    current: Option<Weak<dyn TtsEngine>>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(VoiceEngineState::default()),
            speak_lock: AsyncMutex::new(()),
            stream: AsyncMutex::new(None),
        }
    }

    pub fn get_or_build_engine(&self, force_persist: bool) -> Result<Arc<dyn TtsEngine>, String> {
        #[cfg(target_os = "windows")]
        maybe_preload_libtorch_cuda_dlls();

        // If an engine is already cached (e.g. prepared for streaming auto-voice),
        // always reuse it so manual "Play" and auto streaming share the same instance.
        {
            let mut guard = self
                .engine
                .lock()
                .map_err(|_| "Voice engine lock poisoned".to_string())?;
            if let Some(engine) = guard.cached.clone() {
                debug!("voice: reuse cached TTS engine");
                guard.current = Some(Arc::downgrade(&engine));
                return Ok(engine);
            }
        }

        let persist_env = persist_enabled();
        let persist = persist_env || force_persist;
        if persist {
            let cached = self
                .engine
                .lock()
                .map_err(|_| "Voice engine lock poisoned".to_string())?
                .cached
                .clone();
            if let Some(engine) = cached {
                debug!("voice: reuse cached TTS engine");
                return Ok(engine);
            }
            let engine = build_from_env().map_err(|e| {
                error!("TTS init failed: {e}");
                format!("TTS init failed: {e}")
            })?;
            {
                let mut guard = self
                    .engine
                    .lock()
                    .map_err(|_| "Voice engine lock poisoned".to_string())?;
                guard.cached = Some(engine.clone());
                guard.current = Some(Arc::downgrade(&engine));
            }
            info!(
                "voice: cached TTS engine (persist_env={}, force_persist={})",
                persist_env, force_persist
            );
            Ok(engine)
        } else {
            debug!("voice: building non-persistent TTS engine");
            let engine = build_from_env().map_err(|e| {
                error!("TTS init failed: {e}");
                format!("TTS init failed: {e}")
            })?;
            if let Ok(mut guard) = self.engine.lock() {
                guard.current = Some(Arc::downgrade(&engine));
            }
            Ok(engine)
        }
    }

    pub async fn set_stream_handle(&self, handle: Option<StreamCancelHandle>) {
        let mut guard = self.stream.lock().await;
        *guard = handle;
    }

    pub async fn cancel_active_stream(&self) {
        let handle = self.stream.lock().await.take();
        if let Some(handle) = handle {
            let _ = handle.cancel().await;
        }
    }

    pub fn get_engine_for_stop(&self) -> Result<Option<Arc<dyn TtsEngine>>, String> {
        let guard = self
            .engine
            .lock()
            .map_err(|_| "Voice engine lock poisoned".to_string())?;
        Ok(guard
            .current
            .as_ref()
            .and_then(|weak| weak.upgrade())
            .or_else(|| guard.cached.clone()))
    }
}

fn env_truthy(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "y" | "on"
            )
        })
        .unwrap_or(false)
}

fn persist_enabled() -> bool {
    env_truthy("VOICE_PERSIST") || env_truthy("RCAT_VOICE_PERSIST")
}

fn debug_dll_enabled() -> bool {
    env_truthy("VOICE_DEBUG_DLL")
}

#[cfg(target_os = "windows")]
fn utf16_nul(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn loaded_module_path(module_name: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleW};

    let module_name_w = utf16_nul(module_name);
    let handle = unsafe { GetModuleHandleW(PCWSTR(module_name_w.as_ptr())) }.ok()?;
    let mut buf = vec![0u16; 32_768];
    let len = unsafe { GetModuleFileNameW(Some(handle), &mut buf) };
    if len == 0 {
        return None;
    }
    buf.truncate(len as usize);
    Some(String::from_utf16_lossy(&buf))
}

#[cfg(target_os = "windows")]
fn try_load_library_abs(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::GetLastError;
    use windows::Win32::System::LibraryLoader::LoadLibraryW;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe { LoadLibraryW(PCWSTR(wide.as_ptr())) };
    if handle.is_ok() {
        return Ok(());
    }
    let err = unsafe { GetLastError() };
    Err(format!(
        "LoadLibraryW failed (code={}) for {}",
        err.0,
        path.display()
    ))
}

#[cfg(target_os = "windows")]
static LIBTORCH_DLL_PRELOAD_ONCE: OnceLock<()> = OnceLock::new();

#[cfg(target_os = "windows")]
fn maybe_preload_libtorch_cuda_dlls() {
    let backend = std::env::var("TTS_BACKEND")
        .ok()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if backend != "gpt-sovits" {
        return;
    }

    LIBTORCH_DLL_PRELOAD_ONCE.get_or_init(|| {
        use std::path::PathBuf;

        let debug = debug_dll_enabled();
        let libtorch = std::env::var("LIBTORCH").ok().map(PathBuf::from);
        let Some(libtorch) = libtorch else {
            if debug {
                warn!("voice: LIBTORCH not set; skip DLL preload");
            }
            return;
        };

        let build_version = std::fs::read_to_string(libtorch.join("build-version"))
            .ok()
            .map(|v| v.trim().to_string());
        if debug {
            info!("voice: libtorch_build_version={:?}", build_version);
        }

        let lib_dir = libtorch.join("lib");
        for dll in ["torch.dll", "torch_cpu.dll", "c10.dll", "torch_cuda.dll", "c10_cuda.dll"] {
            let loaded = loaded_module_path(dll);
            let abs = lib_dir.join(dll);
            let exists = abs.exists();

            if debug {
                info!(
                    "voice: dll={} exists_in_libtorch_lib={} loaded_path={:?}",
                    dll, exists, loaded
                );
            }

            if loaded.is_none() && exists {
                match try_load_library_abs(&abs) {
                    Ok(_) => {
                        if debug {
                            info!("voice: LoadLibrary ok: {}", abs.display());
                        }
                    }
                    Err(e) => {
                        // Keep this at warn/error level since it can affect CUDA detection.
                        warn!("voice: {e}");
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub async fn voice_play_text(
    voice: tauri::State<'_, VoiceState>,
    text: String,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }

    // Interrupt any active streaming session and current playback.
    voice.cancel_active_stream().await;
    if let Some(engine) = voice.get_engine_for_stop()? {
        let _ = engine.stop().await;
    }

    // Serialize playback to avoid overlapping writers (rodio backend only supports one active).
    let _speak_guard = voice.speak_lock.lock().await;

    let tts = voice.get_or_build_engine(false)?;
    let metrics = tts
        .speak(text)
        .await
        .map_err(|e| {
            error!("TTS speak failed: {e}");
            format!("TTS speak failed: {e}")
        })?;
    if let Some(rx) = metrics.play_done_rx {
        let _ = rx.await;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_stop(voice: tauri::State<'_, VoiceState>) -> Result<(), String> {
    voice.cancel_active_stream().await;
    let engine = voice.get_engine_for_stop()?;
    if let Some(engine) = engine {
        engine.stop().await.map_err(|e| format!("TTS stop failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_prepare(voice: tauri::State<'_, VoiceState>) -> Result<(), String> {
    let _ = voice.get_or_build_engine(true)?;
    Ok(())
}
