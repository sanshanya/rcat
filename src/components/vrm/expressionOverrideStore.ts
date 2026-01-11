import { useCallback, useSyncExternalStore } from "react";

import type { ExpressionName } from "@/components/vrm/ExpressionDriver";

export type ExpressionOverrideState = {
  enabled: boolean;
  values: Partial<Record<ExpressionName, number>>;
};

let state: ExpressionOverrideState = { enabled: false, values: {} };

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const getExpressionOverrides = () => state;

export const subscribeExpressionOverrides = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setExpressionOverrides = (next: Partial<ExpressionOverrideState>) => {
  state = {
    ...state,
    ...next,
    values: next.values ? { ...next.values } : state.values,
  };
  emitChange();
};

export const useExpressionOverrides = () => {
  const snapshot = useSyncExternalStore(
    subscribeExpressionOverrides,
    getExpressionOverrides,
    getExpressionOverrides
  );

  const setEnabled = useCallback((enabled: boolean) => {
    setExpressionOverrides({ enabled });
  }, []);

  const setValue = useCallback((name: ExpressionName, value: number) => {
    setExpressionOverrides({
      enabled: true,
      values: { ...getExpressionOverrides().values, [name]: value },
    });
  }, []);

  const reset = useCallback(() => {
    setExpressionOverrides({ enabled: false, values: {} });
  }, []);

  return { ...snapshot, setEnabled, setValue, reset };
};

