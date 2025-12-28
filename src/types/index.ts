// src/types/index.ts
// Centralized type definitions for the RCAT application

// Cross-bridge types are generated from Rust to avoid drift.
export type { WindowMode } from '@/bindings/tauri-types';

/**
 * Size dimensions for window operations.
 */
export interface WindowSize {
  w: number;
  h: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  titleAuto: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  lastSeenAtMs: number;
  messageCount: number;
  hasUnseen: boolean;
  isActive: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  seq: number;
  role: string;
  content: string;
  reasoning?: string | null;
  createdAtMs: number;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}

export interface HistoryBootstrap {
  activeConversationId: string;
  conversations: ConversationSummary[];
}
