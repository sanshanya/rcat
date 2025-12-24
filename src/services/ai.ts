// src/services/ai.ts
// AI Service for communicating with Rust backend via Tauri commands

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * AI configuration for OpenAI-compatible endpoints
 */
export interface AiConfig {
  base_url: string;  // snake_case to match Rust struct
  api_key: string;
  model: string;
}

/**
 * Default AI configuration
 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o-mini',
};

/**
 * Event names matching Rust backend
 */
export const AI_EVENTS = {
  CHAT_STREAM: 'chat-stream',
  CHAT_DONE: 'chat-done',
  CHAT_ERROR: 'chat-error',
} as const;

/**
 * Payload from chat-stream events
 */
export interface ChatStreamPayload {
  chunk: string;
  done: boolean;
}

/**
 * Callbacks for streaming chat
 */
export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * Load AI config from .env file via Rust backend
 */
export async function loadAiConfig(): Promise<AiConfig> {
  try {
    return await invoke<AiConfig>('load_ai_config');
  } catch (error) {
    console.warn('Failed to load AI config from .env:', error);
    return DEFAULT_AI_CONFIG;
  }
}

/**
 * Start a streaming chat request.
 * Returns a cleanup function to unsubscribe from events.
 */
export async function streamChat(
  prompt: string,
  config: Partial<AiConfig>,
  callbacks: StreamCallbacks
): Promise<UnlistenFn> {
  const fullConfig = { ...DEFAULT_AI_CONFIG, ...config };

  // Set up event listeners before invoking command
  const unlistenStream = await listen<ChatStreamPayload>(
    AI_EVENTS.CHAT_STREAM,
    (event) => {
      if (event.payload.done) {
        callbacks.onDone();
      } else {
        callbacks.onChunk(event.payload.chunk);
      }
    }
  );

  const unlistenError = await listen<string>(AI_EVENTS.CHAT_ERROR, (event) => {
    callbacks.onError(event.payload);
  });

  // Cleanup function
  const cleanup = () => {
    unlistenStream();
    unlistenError();
  };

  try {
    // Invoke Rust command (async, returns after stream completes)
    await invoke('chat_stream', {
      prompt,
      baseUrl: fullConfig.base_url,
      apiKey: fullConfig.api_key,
      model: fullConfig.model,
    });
  } catch (error) {
    cleanup();
    callbacks.onError(String(error));
  }

  return cleanup;
}

/**
 * Simple non-streaming chat for testing
 */
export async function simpleChat(
  prompt: string,
  config: Partial<AiConfig>
): Promise<string> {
  const fullConfig = { ...DEFAULT_AI_CONFIG, ...config };

  return invoke<string>('chat_simple', {
    prompt,
    baseUrl: fullConfig.base_url,
    apiKey: fullConfig.api_key,
    model: fullConfig.model,
  });
}
