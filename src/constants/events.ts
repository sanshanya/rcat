// src/constants/events.ts
// Event name constants for Tauri backend communication

/** Click-through mode state change event */
export const EVT_CLICK_THROUGH_STATE = 'click-through-state' as const;

/** AI chat stream chunk event */
export const EVT_CHAT_STREAM = 'chat-stream' as const;

/** AI chat completion event */
export const EVT_CHAT_DONE = 'chat-done' as const;

/** AI chat error event */
export const EVT_CHAT_ERROR = 'chat-error' as const;

/** Voice ASR result event (streamed from backend) */
export const EVT_VOICE_ASR_RESULT = 'voice-asr-result' as const;

/** Voice conversation state event */
export const EVT_VOICE_CONVERSATION_STATE = 'voice-conversation-state' as const;

/** Voice RMS (lipsync) event */
export const EVT_VOICE_RMS = 'voice-rms' as const;

/** Voice speech start event */
export const EVT_VOICE_SPEECH_START = 'voice-speech-start' as const;

/** Voice speech end event */
export const EVT_VOICE_SPEECH_END = 'voice-speech-end' as const;

/** Global cursor gaze (backend-provided; works even in click-through mode) */
export const EVT_GLOBAL_CURSOR_GAZE = 'global-cursor-gaze' as const;
