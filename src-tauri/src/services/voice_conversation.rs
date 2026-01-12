use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, watch};
use tokio::time::Instant;

use crate::services::ai::{
    ChatDeltaKind, ChatDonePayload, ChatStreamPayload, EVT_CHAT_DONE, EVT_CHAT_STREAM,
};

use rcat_voice::turn::{
    AudioFrameRef, SmartTurnBoundaryDetector, TurnBoundaryDetector, TurnEvent, TurnEventKind,
    VadGateTurnDetector,
};
use smallvec::SmallVec;

pub const EVT_VOICE_ASR_RESULT: &str = "voice-asr-result";
pub const EVT_VOICE_CONVERSATION_STATE: &str = "voice-conversation-state";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAsrResultPayload {
    pub text: String,
    pub turn_text: String,
    pub start: Option<f32>,
    pub end: Option<f32>,
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConversationStatePayload {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConversationStatus {
    pub running: bool,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

impl Default for VoiceConversationStatus {
    fn default() -> Self {
        Self {
            running: false,
            state: "idle".to_string(),
            last_error: None,
        }
    }
}

pub struct VoiceConversationController {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    task_running: Arc<AtomicBool>,
    cancel_tx: Mutex<Option<watch::Sender<bool>>>,
    conversation_id: watch::Sender<Option<String>>,
    status: watch::Sender<VoiceConversationStatus>,
}

impl VoiceConversationController {
    pub fn new() -> Self {
        let (status, _) = watch::channel(VoiceConversationStatus::default());
        let (conversation_id, _) = watch::channel(None);
        Self {
            task: Mutex::new(None),
            task_running: Arc::new(AtomicBool::new(false)),
            cancel_tx: Mutex::new(None),
            conversation_id,
            status,
        }
    }

    fn set_status(&self, app: &tauri::AppHandle, status: VoiceConversationStatus) {
        let _ = self.status.send(status.clone());
        let _ = app.emit(
            EVT_VOICE_CONVERSATION_STATE,
            VoiceConversationStatePayload {
                state: status.state,
                error: status.last_error,
            },
        );
    }

    pub async fn start(
        &self,
        app: tauri::AppHandle,
        conversation_id: Option<String>,
    ) -> Result<(), String> {
        let conversation_id = conversation_id
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let _ = self.conversation_id.send(conversation_id.clone());

        // Check if already running
        if self.task_running.load(Ordering::SeqCst) {
            return Ok(());
        }

        // Take any old handle (finished or not)
        {
            let mut task = self.task.lock().await;
            *task = None;
        }

        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut guard = self.cancel_tx.lock().await;
            *guard = Some(cancel_tx);
        }

        self.set_status(
            &app,
            VoiceConversationStatus {
                running: true,
                state: "listening".to_string(),
                last_error: None,
            },
        );

        self.task_running.store(true, Ordering::SeqCst);

        let status_tx = self.status.clone();
        let conversation_id_rx = self.conversation_id.subscribe();
        let app_for_task = app.clone();
        let task_running_flag = self.task_running.clone();
        let task_handle = tauri::async_runtime::spawn(async move {
            let result =
                run_voice_asr_loop(app_for_task.clone(), conversation_id_rx, cancel_rx).await;

            task_running_flag.store(false, Ordering::SeqCst);

            let status = match result {
                Ok(()) => VoiceConversationStatus {
                    running: false,
                    state: "idle".to_string(),
                    last_error: None,
                },
                Err(err) => VoiceConversationStatus {
                    running: false,
                    state: "idle".to_string(),
                    last_error: Some(err),
                },
            };

            let _ = status_tx.send(status.clone());
            let _ = app_for_task.emit(
                EVT_VOICE_CONVERSATION_STATE,
                VoiceConversationStatePayload {
                    state: status.state,
                    error: status.last_error,
                },
            );
        });

        {
            let mut task = self.task.lock().await;
            *task = Some(task_handle);
        }

        Ok(())
    }

    pub async fn stop(&self, app: tauri::AppHandle) -> Result<(), String> {
        let cancel = { self.cancel_tx.lock().await.take() };
        if let Some(tx) = cancel {
            let _ = tx.send(true);
        }
        let task: Option<tauri::async_runtime::JoinHandle<()>> = { self.task.lock().await.take() };
        if let Some(handle) = task {
            let _ = handle.await;
        }

        self.task_running.store(false, Ordering::SeqCst);

        self.set_status(
            &app,
            VoiceConversationStatus {
                running: false,
                state: "idle".to_string(),
                last_error: None,
            },
        );
        Ok(())
    }

    pub fn status(&self) -> VoiceConversationStatus {
        self.status.borrow().clone()
    }
}

#[tauri::command]
pub async fn voice_conversation_start(
    app: tauri::AppHandle,
    controller: tauri::State<'_, VoiceConversationController>,
    conversation_id: Option<String>,
) -> Result<(), String> {
    controller.start(app, conversation_id).await
}

#[tauri::command]
pub async fn voice_conversation_stop(
    app: tauri::AppHandle,
    controller: tauri::State<'_, VoiceConversationController>,
) -> Result<(), String> {
    controller.stop(app).await
}

#[tauri::command]
pub async fn voice_conversation_status(
    controller: tauri::State<'_, VoiceConversationController>,
) -> Result<VoiceConversationStatus, String> {
    Ok(controller.status())
}

async fn stop_voice_playback_best_effort(app: &tauri::AppHandle) {
    let voice_state = app.state::<crate::services::voice::VoiceState>();
    voice_state.cancel_active_stream().await;
    if let Ok(Some(engine)) = voice_state.get_engine_for_stop() {
        let _ = engine.stop().await;
    }
}

fn abort_chat_conversation_best_effort(app: &tauri::AppHandle, conversation_id: &str) {
    let streams = app.state::<crate::services::ai::AiStreamManager>();
    let conversation_id_str = conversation_id.trim();
    if conversation_id_str.is_empty() {
        return;
    }

    let Ok(Some((request_id, handle))) = streams.take_conversation(conversation_id_str) else {
        return;
    };

    let handle: tauri::async_runtime::JoinHandle<()> = handle;
    handle.abort();

    let request_id_str: String = request_id;
    let _ = app.emit(
        EVT_CHAT_STREAM,
        ChatStreamPayload {
            request_id: request_id_str.clone(),
            delta: String::new(),
            kind: ChatDeltaKind::Text,
            done: true,
        },
    );
    let _ = app.emit(
        EVT_CHAT_DONE,
        ChatDonePayload {
            request_id: request_id_str,
            conversation_id: Some(conversation_id_str.to_string()),
        },
    );
}

fn env_u64_clamped(key: &str, default: u64, min: u64, max: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

enum TurnDetector {
    Vad(VadGateTurnDetector),
    Smart(SmartTurnBoundaryDetector),
}

impl TurnBoundaryDetector for TurnDetector {
    fn push_audio(&mut self, frame: AudioFrameRef<'_>, out: &mut SmallVec<[TurnEvent; 4]>) {
        match self {
            TurnDetector::Vad(inner) => inner.push_audio(frame, out),
            TurnDetector::Smart(inner) => inner.push_audio(frame, out),
        }
    }

    fn push_vad(&mut self, event: rcat_voice::asr::VadEvent, out: &mut SmallVec<[TurnEvent; 4]>) {
        match self {
            TurnDetector::Vad(inner) => inner.push_vad(event, out),
            TurnDetector::Smart(inner) => inner.push_vad(event, out),
        }
    }

    fn tick(&mut self, now: tokio::time::Instant, out: &mut SmallVec<[TurnEvent; 4]>) {
        match self {
            TurnDetector::Vad(inner) => inner.tick(now, out),
            TurnDetector::Smart(inner) => inner.tick(now, out),
        }
    }

    fn reset(&mut self) {
        match self {
            TurnDetector::Vad(inner) => inner.reset(),
            TurnDetector::Smart(inner) => inner.reset(),
        }
    }
}

async fn run_voice_asr_loop(
    app: tauri::AppHandle,
    conversation_id: watch::Receiver<Option<String>>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    use tokio::sync::oneshot;

    // Create MicStream on a blocking thread since cpal::Stream is !Send.
    // We extract a MicHandle (which is Send+Sync) to use in the async loop.
    let (mic_handle, _mic_keepalive_tx) = {
        let (tx, rx) = oneshot::channel::<
            Result<(rcat_voice::audio::MicHandle, oneshot::Sender<()>), String>,
        >();
        std::thread::spawn(move || {
            let mic = match rcat_voice::audio::MicStream::from_env() {
                Ok(m) => m,
                Err(e) => {
                    let msg = format!("Mic init failed: {e}");
                    log::error!("{msg}");
                    let _ = tx.send(Err(msg));
                    return;
                }
            };
            let handle = mic.handle();
            // Create a keepalive channel - when this sender is dropped, the mic thread exits
            let (keepalive_tx, keepalive_rx) = oneshot::channel::<()>();
            let _ = tx.send(Ok((handle, keepalive_tx)));
            // Block until keepalive is dropped (i.e., the async loop exits)
            let _ = keepalive_rx.blocking_recv();
            // MicStream drops here, stopping the audio capture
        });
        match rx
            .await
            .map_err(|_| "Mic init failed: microphone thread exited unexpectedly".to_string())?
        {
            Ok(value) => value,
            Err(err) => return Err(err),
        }
    };

    let feed_ms = mic_handle.feed_ms();
    let sample_rate = mic_handle.sample_rate();
    let channels = mic_handle.channels();
    log::info!(
        "voice_conversation: mic={}Hz {}ch feed_ms={}",
        sample_rate,
        channels,
        feed_ms
    );

    let mut asr = rcat_voice::asr::SherpaAsrStream::from_env()
        .map_err(|e| format!("ASR init failed: {e}"))?;

    let drop_warn_samples = env_u64_clamped("ASR_MIC_DROP_WARN_SAMPLES", 100, 1, 1_000_000);

    let barge_in_min_speech_ms = env_u64_clamped("BARGE_IN_MIN_SPEECH_MS", 450, 50, 10_000);
    let barge_in_confirm_ms = env_u64_clamped("BARGE_IN_CONFIRM_MS", 100, 0, 1000);
    let barge_in_threshold_ms = barge_in_confirm_ms.saturating_add(barge_in_min_speech_ms);

    let mut turn_detector = match std::env::var("SMART_TURN_MODEL") {
        Ok(value) if !value.trim().is_empty() => {
            let detector = SmartTurnBoundaryDetector::from_env()
                .map_err(|e| format!("Smart Turn init failed: {e}"))?;
            log::info!(
                "voice_conversation: smart_turn enabled (threshold={:.2}, model={})",
                detector.inner().threshold(),
                value
            );
            TurnDetector::Smart(detector)
        }
        _ => TurnDetector::Vad(VadGateTurnDetector::from_env()),
    };

    let mut turn_text = String::new();
    let mut barge_in_speech_start_ts: Option<Instant> = None;
    let mut barge_in_triggered = false;
    let mut events = SmallVec::<[TurnEvent; 4]>::new();

    let frames = ((sample_rate as u64 * feed_ms) / 1000).max(1) as usize;
    let chunk_samples = frames
        .saturating_mul(channels as usize)
        .max(channels as usize);
    let mut chunk = Vec::<i16>::with_capacity(chunk_samples);

    let mut poll = tokio::time::interval(std::time::Duration::from_millis(5));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut drop_tick = tokio::time::interval(std::time::Duration::from_secs(1));
    drop_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            res = cancel.changed() => {
                if res.is_ok() && *cancel.borrow() {
                    break;
                }
            }
            _ = drop_tick.tick() => {
                let n = mic_handle.take_dropped_samples();
                if n > 0 {
                    if n >= drop_warn_samples {
                        log::warn!("voice_conversation: dropped {} samples (ring buffer full)", n);
                    } else {
                        log::debug!("voice_conversation: dropped {} samples (ring buffer full)", n);
                    }
                }
            }
            _ = poll.tick() => {
                let now = Instant::now();
                events.clear();

                while let Some(vad) = asr.try_read_vad_event() {
                    match &vad {
                        rcat_voice::asr::VadEvent::SpeechStart { ts } => {
                            barge_in_speech_start_ts = Some(*ts);
                            barge_in_triggered = false;
                        }
                        rcat_voice::asr::VadEvent::SpeechEnd { .. } => {
                            barge_in_speech_start_ts = None;
                            barge_in_triggered = false;
                        }
                    }
                    turn_detector.push_vad(vad, &mut events);
                }

                while chunk.len() < chunk_samples {
                    let Some(sample) = mic_handle.try_pop_sample() else {
                        break;
                    };
                    chunk.push(sample);
                }

                if chunk.len() >= chunk_samples {
                    let frame = AudioFrameRef {
                        samples: &chunk,
                        sample_rate,
                        channels,
                        ts: now,
                    };
                    turn_detector.push_audio(frame, &mut events);
                    asr.write_pcm_i16(&chunk, sample_rate, channels)
                        .await
                        .map_err(|e| format!("ASR write failed: {e}"))?;
                    chunk.clear();
                }

                while let Some(seg) = asr.try_read() {
                    let seg_text = seg.text.trim();
                    if seg_text.is_empty() {
                        continue;
                    }

                    if !turn_text.is_empty() {
                        turn_text.push(' ');
                    }
                    turn_text.push_str(seg_text);

                    let _ = app.emit(
                        EVT_VOICE_ASR_RESULT,
                        VoiceAsrResultPayload {
                            text: seg_text.to_string(),
                            turn_text: turn_text.clone(),
                            start: Some(seg.start),
                            end: Some(seg.end),
                            is_final: false,
                        },
                    );
                }

                turn_detector.tick(now, &mut events);

                if !barge_in_triggered {
                    if let Some(start_ts) = barge_in_speech_start_ts {
                        let speech_ms =
                            now.saturating_duration_since(start_ts).as_millis() as u64;
                        if speech_ms >= barge_in_threshold_ms {
                            barge_in_triggered = true;
                            log::warn!(
                                "voice_conversation: barge-in detected (speech_ms={} >= {}, confirm_ms={}), aborting playback/conversation",
                                speech_ms,
                                barge_in_min_speech_ms,
                                barge_in_confirm_ms
                            );
                            stop_voice_playback_best_effort(&app).await;
                            if let Some(cid) = conversation_id.borrow().as_deref() {
                                abort_chat_conversation_best_effort(&app, cid);
                            }
                        }
                    }
                }

                let mut committed = false;
                for event in events.drain(..) {
                    if event.kind == TurnEventKind::TurnCommitted {
                        committed = true;
                    }
                }

                if committed {
                    while let Some(seg) = asr.try_read() {
                        let seg_text = seg.text.trim();
                        if seg_text.is_empty() {
                            continue;
                        }

                        if !turn_text.is_empty() {
                            turn_text.push(' ');
                        }
                        turn_text.push_str(seg_text);

                        let _ = app.emit(
                            EVT_VOICE_ASR_RESULT,
                            VoiceAsrResultPayload {
                                text: seg_text.to_string(),
                                turn_text: turn_text.clone(),
                                start: Some(seg.start),
                                end: Some(seg.end),
                                is_final: false,
                            },
                        );
                    }

                    let user_text = turn_text.trim().to_string();
                    turn_text.clear();
                    barge_in_speech_start_ts = None;
                    barge_in_triggered = false;
                    turn_detector.reset();

                    if !user_text.is_empty() {
                        let _ = app.emit(
                            EVT_VOICE_ASR_RESULT,
                            VoiceAsrResultPayload {
                                text: user_text.clone(),
                                turn_text: user_text,
                                start: None,
                                end: None,
                                is_final: true,
                            },
                        );
                    }
                }
            }
        }
    }

    asr.finish().await.map_err(|e| e.to_string())?;
    Ok(())
}
