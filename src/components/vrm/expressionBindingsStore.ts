import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { ExpressionBindings, ExpressionName } from "@/components/vrm/ExpressionDriver";
import {
  getVrmExpressionBindings,
  setVrmExpressionBindings,
  type PersistedVrmExpressionBindings,
} from "@/services/vrmSettings";

type ExpressionBindingsSnapshot = {
  url: string | null;
  bindings: ExpressionBindings;
  loaded: boolean;
};

const STORAGE_PREFIX = "rcat.vrm.expressionBindings";

const storageKey = (url: string) => `${STORAGE_PREFIX}:${encodeURIComponent(url)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeBindings = (raw: unknown): ExpressionBindings => {
  if (!isRecord(raw)) return {};
  const next: ExpressionBindings = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    next[key as ExpressionName] = trimmed;
  });
  return next;
};

const serializeBindings = (bindings: ExpressionBindings): PersistedVrmExpressionBindings => {
  const out: PersistedVrmExpressionBindings = {};
  Object.entries(bindings).forEach(([key, value]) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    out[key] = trimmed;
  });
  return out;
};

const readLocalBindings = (url: string): ExpressionBindings | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(url));
    if (!raw) return null;
    return normalizeBindings(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeLocalBindings = (url: string, bindings: ExpressionBindings) => {
  if (typeof window === "undefined") return;
  try {
    const payload = serializeBindings(bindings);
    if (Object.keys(payload).length === 0) {
      window.localStorage.removeItem(storageKey(url));
      return;
    }
    window.localStorage.setItem(storageKey(url), JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
};

let state: ExpressionBindingsSnapshot = { url: null, bindings: {}, loaded: false };
const listeners = new Set<() => void>();
let loadSeq = 0;

const emitChange = () => listeners.forEach((listener) => listener());

export const getExpressionBindingsSnapshot = () => state;

export const subscribeExpressionBindings = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getCachedExpressionBindings = (url: string | null): ExpressionBindings => {
  const normalized = url?.trim() ?? "";
  if (!normalized) return {};
  if (state.url === normalized) return state.bindings;
  return readLocalBindings(normalized) ?? {};
};

export const loadExpressionBindings = async (url: string | null) => {
  const normalized = url?.trim() ?? "";
  loadSeq += 1;
  const seq = loadSeq;

  if (!normalized) {
    state = { url: null, bindings: {}, loaded: false };
    emitChange();
    return;
  }

  const local = readLocalBindings(normalized) ?? {};
  state = { url: normalized, bindings: local, loaded: false };
  emitChange();

  const remote = await getVrmExpressionBindings(normalized);
  if (seq !== loadSeq) return;
  if (remote) {
    const bindings = normalizeBindings(remote);
    state = { url: normalized, bindings, loaded: true };
    writeLocalBindings(normalized, bindings);
    emitChange();
    return;
  }

  state = { url: normalized, bindings: local, loaded: true };
  emitChange();

  const payload = serializeBindings(local);
  if (Object.keys(payload).length > 0) {
    void setVrmExpressionBindings(normalized, payload);
  }
};

export const setExpressionBindingsForUrl = (url: string, bindings: ExpressionBindings) => {
  const normalized = url.trim();
  if (!normalized) return;
  const next = normalizeBindings(serializeBindings(bindings));
  state = { url: normalized, bindings: next, loaded: true };
  writeLocalBindings(normalized, next);
  emitChange();
  void setVrmExpressionBindings(normalized, serializeBindings(next));
};

export const setExpressionBinding = (
  url: string,
  slot: ExpressionName,
  expression: string | null
) => {
  const normalized = url.trim();
  if (!normalized) return;
  const current = state.url === normalized ? state.bindings : getCachedExpressionBindings(normalized);
  const next: ExpressionBindings = { ...current };
  const trimmed = expression?.trim() ?? "";
  if (!trimmed) {
    delete next[slot];
  } else {
    next[slot] = trimmed;
  }
  setExpressionBindingsForUrl(normalized, next);
};

export const resetExpressionBindings = (url: string) => {
  const normalized = url.trim();
  if (!normalized) return;
  setExpressionBindingsForUrl(normalized, {});
};

export const useExpressionBindings = (url: string | null) => {
  const snapshot = useSyncExternalStore(
    subscribeExpressionBindings,
    getExpressionBindingsSnapshot,
    getExpressionBindingsSnapshot
  );

  useEffect(() => {
    void loadExpressionBindings(url);
  }, [url]);

  const setBinding = useCallback(
    (slot: ExpressionName, expression: string | null) => {
      const normalized = url?.trim() ?? "";
      if (!normalized) return;
      setExpressionBinding(normalized, slot, expression);
    },
    [url]
  );

  const reset = useCallback(() => {
    const normalized = url?.trim() ?? "";
    if (!normalized) return;
    resetExpressionBindings(normalized);
  }, [url]);

  return { ...snapshot, setBinding, reset };
};
