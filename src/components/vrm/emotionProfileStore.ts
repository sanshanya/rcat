import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { EmotionId } from "@/components/vrm/emotionTypes";
import { EMOTION_OPTIONS } from "@/components/vrm/emotionTypes";
import {
  getVrmEmotionProfile,
  setVrmEmotionProfile,
  type PersistedVrmEmotionProfile,
} from "@/services/vrmSettings";

export type EmotionMotionMapping = {
  motionId: string | null;
  loopMotion: boolean;
};

export type EmotionProfile = Record<EmotionId, EmotionMotionMapping>;

type EmotionProfileSnapshot = {
  url: string | null;
  profile: EmotionProfile;
  loaded: boolean;
};

const STORAGE_PREFIX = "rcat.vrm.emotionProfile";

const storageKey = (url: string) => `${STORAGE_PREFIX}:${encodeURIComponent(url)}`;

const DEFAULT_LOOP = true;

const makeDefaultProfile = (): EmotionProfile => {
  const base = {} as EmotionProfile;
  EMOTION_OPTIONS.forEach((item) => {
    base[item.id] = { motionId: null, loopMotion: DEFAULT_LOOP };
  });
  return base;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isEmotionId = (value: string): value is EmotionId =>
  EMOTION_OPTIONS.some((item) => item.id === value);

const normalizeProfile = (raw: unknown): EmotionProfile => {
  const out = makeDefaultProfile();
  if (!isRecord(raw)) return out;
  Object.entries(raw).forEach(([key, value]) => {
    if (!isEmotionId(key)) return;
    if (!isRecord(value)) return;
    const motionIdRaw = value.motionId;
    const loopRaw = value.loopMotion;
    const motionId =
      typeof motionIdRaw === "string" && motionIdRaw.trim().length > 0
        ? motionIdRaw.trim()
        : null;
    const loopMotion = typeof loopRaw === "boolean" ? loopRaw : DEFAULT_LOOP;
    out[key] = { motionId, loopMotion };
  });
  return out;
};

const serializeProfile = (profile: EmotionProfile): PersistedVrmEmotionProfile => {
  const out: PersistedVrmEmotionProfile = {};
  EMOTION_OPTIONS.forEach((item) => {
    const entry = profile[item.id];
    if (!entry || !entry.motionId) return;
    out[item.id] = {
      motionId: entry.motionId,
      loopMotion: entry.loopMotion,
    };
  });
  return out;
};

const readLocalProfile = (url: string): EmotionProfile | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(url));
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeLocalProfile = (url: string, profile: EmotionProfile) => {
  if (typeof window === "undefined") return;
  try {
    const payload = serializeProfile(profile);
    if (Object.keys(payload).length === 0) {
      window.localStorage.removeItem(storageKey(url));
      return;
    }
    window.localStorage.setItem(storageKey(url), JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
};

let state: EmotionProfileSnapshot = {
  url: null,
  profile: makeDefaultProfile(),
  loaded: false,
};

const listeners = new Set<() => void>();
let loadSeq = 0;

const emitChange = () => listeners.forEach((listener) => listener());

export const getEmotionProfileSnapshot = () => state;

export const subscribeEmotionProfile = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getCachedEmotionProfile = (url: string | null): EmotionProfile => {
  const normalized = url?.trim() ?? "";
  if (!normalized) return makeDefaultProfile();
  if (state.url === normalized) return state.profile;
  return readLocalProfile(normalized) ?? makeDefaultProfile();
};

export const loadEmotionProfile = async (url: string | null) => {
  const normalized = url?.trim() ?? "";
  loadSeq += 1;
  const seq = loadSeq;

  if (!normalized) {
    state = { url: null, profile: makeDefaultProfile(), loaded: false };
    emitChange();
    return;
  }

  const local = readLocalProfile(normalized) ?? makeDefaultProfile();
  state = { url: normalized, profile: local, loaded: false };
  emitChange();

  const remote = await getVrmEmotionProfile(normalized);
  if (seq !== loadSeq) return;
  if (remote) {
    const profile = normalizeProfile(remote);
    state = { url: normalized, profile, loaded: true };
    writeLocalProfile(normalized, profile);
    emitChange();
    return;
  }

  state = { url: normalized, profile: local, loaded: true };
  emitChange();

  const payload = serializeProfile(local);
  if (Object.keys(payload).length > 0) {
    void setVrmEmotionProfile(normalized, payload);
  }
};

export const setEmotionMotionForUrl = (
  url: string,
  emotion: EmotionId,
  mapping: Partial<EmotionMotionMapping>
) => {
  const normalized = url.trim();
  if (!normalized) return;
  const current = state.url === normalized ? state.profile : getCachedEmotionProfile(normalized);
  const next: EmotionProfile = { ...current, [emotion]: { ...current[emotion], ...mapping } };
  state = { url: normalized, profile: next, loaded: true };
  writeLocalProfile(normalized, next);
  emitChange();
  void setVrmEmotionProfile(normalized, serializeProfile(next));
};

export const resetEmotionProfile = (url: string) => {
  const normalized = url.trim();
  if (!normalized) return;
  const next = makeDefaultProfile();
  state = { url: normalized, profile: next, loaded: true };
  writeLocalProfile(normalized, next);
  emitChange();
  void setVrmEmotionProfile(normalized, {});
};

export const useEmotionProfile = (url: string | null) => {
  const snapshot = useSyncExternalStore(
    subscribeEmotionProfile,
    getEmotionProfileSnapshot,
    getEmotionProfileSnapshot
  );

  useEffect(() => {
    void loadEmotionProfile(url);
  }, [url]);

  const setMotion = useCallback(
    (emotion: EmotionId, motionId: string | null) => {
      const normalized = url?.trim() ?? "";
      if (!normalized) return;
      setEmotionMotionForUrl(normalized, emotion, { motionId });
    },
    [url]
  );

  const setLoop = useCallback(
    (emotion: EmotionId, loopMotion: boolean) => {
      const normalized = url?.trim() ?? "";
      if (!normalized) return;
      setEmotionMotionForUrl(normalized, emotion, { loopMotion });
    },
    [url]
  );

  const reset = useCallback(() => {
    const normalized = url?.trim() ?? "";
    if (!normalized) return;
    resetEmotionProfile(normalized);
  }, [url]);

  return { ...snapshot, setMotion, setLoop, reset };
};

