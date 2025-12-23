// src/types/index.ts
// Centralized type definitions for the RCAT application

/**
 * Represents a single message in the chat conversation.
 * This type will be extended when integrating with real AI APIs.
 */
export interface Message {
  role: 'user' | 'ai';
  content: string;
  // Future fields for AI integration:
  // timestamp?: number;
  // model?: string;
  // tokens?: { prompt: number; completion: number };
  // error?: string;
}

/**
 * Roles in the conversation.
 */
export type MessageRole = 'user' | 'ai';

/**
 * Window modes for the application FSM.
 * - mini: Collapsed capsule state
 * - input: Expanded input field
 * - result: Full chat view with message history
 */
export type WindowMode = 'mini' | 'input' | 'result';

/**
 * Size dimensions for window operations.
 */
export interface WindowSize {
  w: number;
  h: number;
}

/**
 * Constraints for resize operations.
 */
export interface ResizeConstraints {
  maxW: number;
  maxH: number;
}
