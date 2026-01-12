use log::{debug, error, info, warn};
use rcat_voice::audio::RmsPayload;
use rcat_voice::generator::{TtsEngine, build_from_env_with_rms_sender};
use rcat_voice::streaming::StreamCancelHandle;
use rcat_voice::turn::TurnManager;
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex as AsyncMutex, mpsc};

pub const EVT_VOICE_RMS: &str = "voice-rms";
pub const EVT_VOICE_SPEECH_START: &str = "voice-speech-start";
pub const EVT_VOICE_SPEECH_END: &str = "voice-speech-end";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRmsPayload {
    pub rms: f32,
    pub peak: f32,
    pub buffered_ms: u64,
    pub speaking: bool,
    pub turn_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSpeechPayload {
    pub turn_id: u64,
}

pub struct VoiceState {
    engine: Mutex<VoiceEngineState>,
    build_lock: Mutex<()>,
    speak_lock: AsyncMutex<()>,
    stream: AsyncMutex<Option<StreamCancelHandle>>,
    rms_tx: mpsc::UnboundedSender<RmsPayload>,
    rms_rx: Arc<AsyncMutex<Option<mpsc::UnboundedReceiver<RmsPayload>>>>,
    active_turn_id: Arc<AtomicU64>,
}

#[derive(Default)]
struct VoiceEngineState {
    cached: Option<Arc<dyn TtsEngine>>,
    current: Option<Weak<dyn TtsEngine>>,
    turn_manager: Option<Arc<TurnManager>>,
}

impl VoiceState {
    pub fn new() -> Self {
        let (rms_tx, rms_rx) = mpsc::unbounded_channel::<RmsPayload>();
        Self {
            engine: Mutex::new(VoiceEngineState::default()),
            build_lock: Mutex::new(()),
            speak_lock: AsyncMutex::new(()),
            stream: AsyncMutex::new(None),
            rms_tx,
            rms_rx: Arc::new(AsyncMutex::new(Some(rms_rx))),
            active_turn_id: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn spawn_rms_emitter(&self, app: tauri::AppHandle) {
        let rms_rx = self.rms_rx.clone();
        let active_turn_id = self.active_turn_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut rx = {
                let mut guard = rms_rx.lock().await;
                guard.take()
            };
            let Some(ref mut rx) = rx else {
                return;
            };
            // Use mpsc recv() which receives ALL events, unlike watch which drops intermediate
            while let Some(payload) = rx.recv().await {
                let turn_id = active_turn_id.load(Ordering::Acquire);
                let _ = app.emit(
                    EVT_VOICE_RMS,
                    VoiceRmsPayload {
                        rms: payload.rms,
                        peak: payload.peak,
                        buffered_ms: payload.buffered_ms,
                        speaking: payload.speaking,
                        turn_id,
                    },
                );
            }
        });
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
                if guard.turn_manager.is_none() {
                    guard.turn_manager =
                        TurnManager::from_tts_engine(engine.as_ref()).map(Arc::new);
                }
                return Ok(engine);
            }
        }

        let _build_guard = self
            .build_lock
            .lock()
            .map_err(|_| "Voice engine build lock poisoned".to_string())?;

        // Another thread may have finished initialization while we waited.
        {
            let mut guard = self
                .engine
                .lock()
                .map_err(|_| "Voice engine lock poisoned".to_string())?;
            if let Some(engine) = guard.cached.clone() {
                debug!("voice: reuse cached TTS engine (post-lock)");
                guard.current = Some(Arc::downgrade(&engine));
                if guard.turn_manager.is_none() {
                    guard.turn_manager =
                        TurnManager::from_tts_engine(engine.as_ref()).map(Arc::new);
                }
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
            let engine = build_from_env_with_rms_sender(self.rms_tx.clone()).map_err(|e| {
                error!("TTS init failed: {e:?}");
                format!("TTS init failed: {e}")
            })?;
            {
                let mut guard = self
                    .engine
                    .lock()
                    .map_err(|_| "Voice engine lock poisoned".to_string())?;
                guard.cached = Some(engine.clone());
                guard.current = Some(Arc::downgrade(&engine));
                guard.turn_manager = TurnManager::from_tts_engine(engine.as_ref()).map(Arc::new);
            }
            info!(
                "voice: cached TTS engine (persist_env={}, force_persist={})",
                persist_env, force_persist
            );
            Ok(engine)
        } else {
            debug!("voice: building non-persistent TTS engine");
            let engine = build_from_env_with_rms_sender(self.rms_tx.clone()).map_err(|e| {
                error!("TTS init failed: {e:?}");
                format!("TTS init failed: {e}")
            })?;
            if let Ok(mut guard) = self.engine.lock() {
                guard.current = Some(Arc::downgrade(&engine));
                guard.turn_manager = TurnManager::from_tts_engine(engine.as_ref()).map(Arc::new);
            }
            Ok(engine)
        }
    }

    pub fn allocate_turn_id(&self) -> Result<u64, String> {
        let turn_manager = {
            let mut guard = self
                .engine
                .lock()
                .map_err(|_| "Voice engine lock poisoned".to_string())?;
            if let Some(manager) = guard.turn_manager.clone() {
                manager
            } else {
                let engine = guard
                    .current
                    .as_ref()
                    .and_then(|weak| weak.upgrade())
                    .or_else(|| guard.cached.clone())
                    .ok_or_else(|| "TTS engine is not initialized".to_string())?;
                let manager = TurnManager::from_tts_engine(engine.as_ref())
                    .map(Arc::new)
                    .unwrap_or_else(|| {
                        Arc::new(TurnManager::new(rcat_voice::audio::CancelToken::new()))
                    });
                guard.turn_manager = Some(manager.clone());
                manager
            }
        };

        let ctx = turn_manager.advance_turn_no_cancel();
        let turn_id = ctx.turn_id();
        self.active_turn_id.store(turn_id, Ordering::Release);
        Ok(turn_id)
    }

    pub fn active_turn_id(&self) -> u64 {
        self.active_turn_id.load(Ordering::Acquire)
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

fn env_bool01(name: &str) -> Option<bool> {
    let raw = std::env::var(name).ok()?;
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "y" | "on" => Some(true),
        "0" | "false" | "no" | "n" | "off" => Some(false),
        _ => None,
    }
}

fn persist_enabled() -> bool {
    env_truthy("VOICE_PERSIST") || env_truthy("RCAT_VOICE_PERSIST")
}

#[cfg(target_os = "windows")]
fn debug_dll_enabled() -> bool {
    env_truthy("VOICE_DEBUG_DLL")
}

fn tts_metrics_enabled() -> bool {
    env_truthy("VOICE_TTS_METRICS")
}

#[cfg(target_os = "windows")]
fn utf16_nul(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn loaded_module_path(module_name: &str) -> Option<String> {
    use windows::Win32::System::LibraryLoader::{GetModuleFileNameW, GetModuleHandleW};
    use windows::core::PCWSTR;

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
    use windows::Win32::Foundation::GetLastError;
    use windows::Win32::System::LibraryLoader::LoadLibraryW;
    use windows::core::PCWSTR;

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
        for dll in [
            "torch.dll",
            "torch_cpu.dll",
            "c10.dll",
            "torch_cuda.dll",
            "c10_cuda.dll",
        ] {
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

/// Force preload libtorch DLLs at application startup.
/// Call this BEFORE any ONNX Runtime components are initialized to avoid CRT heap conflicts.
#[cfg(target_os = "windows")]
pub fn force_preload_libtorch() {
    use std::path::PathBuf;

    LIBTORCH_DLL_PRELOAD_ONCE.get_or_init(|| {
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
        info!(
            "voice: force preload libtorch (version={:?})",
            build_version
        );

        let lib_dir = libtorch.join("lib");
        for dll in [
            "torch.dll",
            "torch_cpu.dll",
            "c10.dll",
            "torch_cuda.dll",
            "c10_cuda.dll",
        ] {
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
                        warn!("voice: {e}");
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub async fn voice_play_text(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceState>,
    text: String,
) -> Result<(), String> {
    let text = text.trim().to_string();
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
    let turn_id = voice.allocate_turn_id()?;

    let _ = app.emit(EVT_VOICE_SPEECH_START, VoiceSpeechPayload { turn_id });
    struct SpeechEndGuard {
        app: tauri::AppHandle,
        turn_id: u64,
    }
    impl Drop for SpeechEndGuard {
        fn drop(&mut self) {
            let _ = self.app.emit(
                EVT_VOICE_SPEECH_END,
                VoiceSpeechPayload {
                    turn_id: self.turn_id,
                },
            );
        }
    }
    let _speech_guard = SpeechEndGuard {
        app: app.clone(),
        turn_id,
    };

    let backend = std::env::var("TTS_BACKEND")
        .ok()
        .unwrap_or_else(|| "auto".to_string());
    let backend_norm = backend
        .trim()
        .rsplit_once('=')
        .map(|(_, v)| v)
        .unwrap_or(backend.trim())
        .to_ascii_lowercase();
    let use_stream = env_bool01("VOICE_PLAY_USE_STREAM")
        .or_else(|| env_bool01("VOICE_PLAY_STREAM"))
        .unwrap_or_else(|| {
            matches!(
                backend_norm.as_str(),
                "remote" | "gpt-sovits-onnx" | "gpt-sovits"
            )
        });

    if use_stream && backend_norm != "os" {
        let session = rcat_voice::streaming::StreamSessionBuilder::from_env(tts)
            .turn_id(turn_id)
            .build();
        voice.set_stream_handle(Some(session.cancel_handle())).await;

        let control = session.control();
        let tx = control.sender();
        let send_failed = tx.send(text.to_string()).await.is_err();

        drop(tx);
        drop(control);

        let result = session
            .finish()
            .await
            .map_err(|e| format!("TTS stream finish failed: {e}"));
        voice.set_stream_handle(None).await;
        if send_failed {
            return Err("TTS stream input closed".to_string());
        }
        return result;
    }

    let metrics = tts.speak(&text).await.map_err(|e| {
        error!("TTS speak failed: {e:?}");
        format!("TTS speak failed: {e}")
    })?;

    let metrics_enabled = tts_metrics_enabled();
    let start_ts = metrics.start_ts;
    let first_audio_ts = metrics.first_audio_ts.unwrap_or(start_ts);
    let ttfb_ms = first_audio_ts
        .saturating_duration_since(start_ts)
        .as_millis();
    let gen_ms = metrics
        .gen_done_ts
        .saturating_duration_since(start_ts)
        .as_millis();
    let play_pred_ms = metrics
        .play_done_ts
        .saturating_duration_since(start_ts)
        .as_millis();
    let buffered_ms = tts.buffered_ms();

    let play_actual_ms = if let Some(rx) = metrics.play_done_rx {
        match rx.await {
            Ok(ts) => Some(ts.saturating_duration_since(start_ts).as_millis()),
            Err(_) => None,
        }
    } else {
        None
    };

    if metrics_enabled {
        info!(
            "voice: turn_id={} tts backend={} ttfb_ms={} gen_ms={} play_pred_ms={} play_actual_ms={:?} buffered_ms={:?}",
            turn_id, backend, ttfb_ms, gen_ms, play_pred_ms, play_actual_ms, buffered_ms
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_stop(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    voice.cancel_active_stream().await;
    let engine = voice.get_engine_for_stop()?;
    if let Some(engine) = engine {
        engine
            .stop()
            .await
            .map_err(|e| format!("TTS stop failed: {e}"))?;
    }
    let _ = app.emit(
        EVT_VOICE_SPEECH_END,
        VoiceSpeechPayload {
            turn_id: voice.active_turn_id(),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn voice_prepare(app: tauri::AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let voice = app_handle.state::<VoiceState>();
        if let Err(err) = voice.get_or_build_engine(true) {
            warn!("voice: prepare failed: {err}");
        }
    });
    Ok(())
}
