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

/**
 * Constraints for resize operations.
 */
export interface ResizeConstraints {
  maxW: number;
  maxH: number;
}
