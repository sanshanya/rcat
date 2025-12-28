// src/hooks/useWindowManager.ts
import { useState, useCallback } from 'react';
import type { WindowMode, WindowSize } from '../types';
import { isTauriContext, reportPromiseError } from '../utils';
import { resizeWindow, setWindowMode } from '@/services/window';

// Re-export for convenience
export type { WindowMode, WindowSize };

/**
 * Hook to manage window mode FSM.
 * Window sizing is fully delegated to Rust WindowStateStore.
 */
export function useWindowManager() {
  const [mode, setMode] = useState<WindowMode>('mini');

  /**
   * Change window mode with optional size override.
   * Handles the complex logic of restoring manual sizes.
   */
  const changeMode = useCallback(async (
    newMode: WindowMode, 
    override?: WindowSize
  ) => {
    if (!isTauriContext()) {
      setMode(newMode);
      return;
    }

    // Always apply backend mode constraints and persisted sizing.
    await setWindowMode(newMode);

    // Update UI only after backend applies constraints/sizing to avoid races with
    // frontend auto-fit logic (which depends on the current mode).
    setMode(newMode);
    
    if (newMode === 'result' && override) {
      await resizeWindow(override.w, override.h);
    }
  }, []);

  /**
   * Reset all window state (called on minimize/collapse)
   */
  const reset = useCallback(() => {
    void changeMode('mini').catch(
      reportPromiseError('useWindowManager.reset', { onceKey: 'useWindowManager.reset' })
    );
  }, [changeMode]);

  return {
    mode,
    changeMode,
    reset,
  };
}
