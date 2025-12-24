// src/types/index.ts
// Centralized type definitions for the RCAT application

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
