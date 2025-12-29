// src/types/index.ts
// Centralized type definitions for the RCAT application

// Cross-bridge types are generated from Rust to avoid drift.
export type {
  AiProvider,
  AiConfig,
  AiModel,
  ConversationDetail,
  ConversationMessage,
  ConversationSummary,
  HistoryBootstrap,
  WindowMode,
} from '@/bindings/tauri-types';

/**
 * Size dimensions for window operations.
 */
export interface WindowSize {
  w: number;
  h: number;
}
