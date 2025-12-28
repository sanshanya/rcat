// src/hooks/useWindowManager.ts
import { useState, useCallback } from 'react';
import type { WindowMode } from '../types';
import { isTauriContext, reportPromiseError } from '../utils';
import { setWindowMode } from '@/services/window';

// Re-export for convenience
export type { WindowMode };

/**
 * Hook to manage window mode FSM.
 * Window sizing is fully delegated to Rust WindowStateStore.
 */
export function useWindowManager() {
  const [mode, setMode] = useState<WindowMode>('mini');

  /**
   * Change window mode.
   * Window sizing is delegated to Rust `WindowStateStore`.
   */
  const changeMode = useCallback(async (newMode: WindowMode) => {
    if (!isTauriContext()) {
      setMode(newMode);
      return;
    }

    // Always apply backend mode constraints and persisted sizing.
    await setWindowMode(newMode);

    // Update UI only after backend applies constraints/sizing to avoid races with
    // frontend auto-fit logic (which depends on the current mode).
    setMode(newMode);
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
