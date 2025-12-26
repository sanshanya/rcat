// src/hooks/useWindowManager.ts
import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MIN_INPUT_WIDTH, DEFAULT_RESULT_SIZE } from '../constants/window';
import type { WindowMode, WindowSize } from '../types';
import { isTauriContext } from '../utils';

// Re-export for convenience
export type { WindowMode, WindowSize };

/**
 * Hook to manage window mode FSM and resize logic.
 * Encapsulates all Tauri window commands and resize state.
 */
export function useWindowManager() {
  const [mode, setMode] = useState<WindowMode>('mini');
  const [inputWidth, setInputWidth] = useState<number | null>(null);
  const [resultSize, setResultSize] = useState<WindowSize | null>(null);
  
  // Refs for resize drag (avoids stale state issues we fixed earlier)
  const startSizeRef = useRef<WindowSize | null>(null);
  const constraintsRef = useRef<WindowSize | null>(null);

  /**
   * Change window mode with optional size override.
   * Handles the complex logic of restoring manual sizes.
   */
  const changeMode = useCallback(async (
    newMode: WindowMode, 
    override?: WindowSize
  ) => {
    setMode(newMode);
    
    if (newMode === 'result') {
      const size = override || resultSize || DEFAULT_RESULT_SIZE;
      if (override) setResultSize(override);
      if (!isTauriContext()) return;
      await invoke('resize_window', { width: size.w, height: size.h });
    } else if (newMode === 'input' && inputWidth) {
      // Restore manual input width if set
      if (!isTauriContext()) return;
      await invoke('resize_input_width', { desiredWidth: inputWidth });
    } else {
      if (!isTauriContext()) return;
      await invoke('set_window_mode', { mode: newMode });
    }
  }, [inputWidth, resultSize]);

  /**
   * Reset all window state (called on minimize/collapse)
   */
  const reset = useCallback(() => {
    setInputWidth(null);
    // Note: We don't reset resultSize to allow persistence across sessions
    void changeMode('mini').catch(() => undefined);
  }, [changeMode]);

  /**
   * Start a resize operation - captures current size synchronously
   */
  const startResize = useCallback(() => {
    // Sync capture to avoid stale state (lesson learned from earlier bugs)
    startSizeRef.current = { w: window.innerWidth, h: window.innerHeight };
    
    if (!isTauriContext()) {
      constraintsRef.current = { w: 8000, h: 8000 };
      return;
    }

    // Async fetch constraints (fire & forget)
    invoke<[number, number]>('get_drag_constraints')
      .then(([maxW, maxH]) => { 
        constraintsRef.current = { w: maxW, h: maxH }; 
      })
      .catch(() => { 
        constraintsRef.current = { w: 8000, h: 8000 }; 
      });
  }, []);

  /**
   * Apply resize delta during drag
   */
  const applyResize = useCallback((dx: number, dy: number) => {
    if (!startSizeRef.current) return;
    
    const { w: startW, h: startH } = startSizeRef.current;
    const maxW = constraintsRef.current?.w || 8000;
    const maxH = constraintsRef.current?.h || 8000;

    const newW = Math.min(Math.max(MIN_INPUT_WIDTH, startW + dx), maxW);
    const newH = Math.min(Math.max(100, startH + dy), maxH);

    if (mode === 'input') {
      setInputWidth(newW);
      if (isTauriContext()) {
        void invoke('resize_input_width', { desiredWidth: newW }).catch(() => undefined);
      }
    } else if (mode === 'result') {
      setResultSize({ w: newW, h: newH });
      if (isTauriContext()) {
        void invoke('resize_window', { width: newW, height: newH }).catch(() => undefined);
      }
    }
  }, [mode]);

  /**
   * Request auto-resize for input width (during typing)
   */
  const requestAutoResize = useCallback((desiredWidth: number) => {
    // Skip if manual override is active
    if (inputWidth !== null) return;
    if (!isTauriContext()) return;
    void invoke('resize_input_width', { desiredWidth }).catch(() => undefined);
  }, [inputWidth]);

  return {
    mode,
    inputWidth,
    resultSize,
    changeMode,
    reset,
    startResize,
    applyResize,
    requestAutoResize,
  };
}
