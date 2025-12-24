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
