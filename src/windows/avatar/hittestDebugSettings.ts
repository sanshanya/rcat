export const HITTEST_DOT_STORAGE_KEY = "rcat.debug.hittestMouseDot";
export const HITTEST_MASK_MAX_EDGE_KEY = "rcat.debug.hittestMaskMaxEdge";
export const HITTEST_ALPHA_THRESHOLD_KEY = "rcat.debug.hittestAlphaThreshold";
export const HITTEST_DILATION_KEY = "rcat.debug.hittestDilation";
export const HITTEST_RECT_SMOOTH_ALPHA_KEY = "rcat.debug.hittestRectSmoothAlpha";
export const HITTEST_ASYNC_READBACK_KEY = "rcat.debug.hittestAsyncReadback";

export const DEFAULT_HITTEST_MASK_MAX_EDGE = 160;
export const DEFAULT_HITTEST_ALPHA_THRESHOLD = 32;
export const DEFAULT_HITTEST_DILATION = 1;
export const DEFAULT_HITTEST_RECT_SMOOTH_ALPHA = 0.35;
export const DEFAULT_HITTEST_ASYNC_READBACK = true;

export const HITTEST_MASK_MAX_EDGE_MIN = 32;
export const HITTEST_MASK_MAX_EDGE_MAX = 512;
export const HITTEST_ALPHA_THRESHOLD_MIN = 0;
export const HITTEST_ALPHA_THRESHOLD_MAX = 255;
export const HITTEST_DILATION_MIN = 0;
export const HITTEST_DILATION_MAX = 8;
export const HITTEST_RECT_SMOOTH_ALPHA_MIN = 0;
export const HITTEST_RECT_SMOOTH_ALPHA_MAX = 1;

export type HitTestMaskTuning = {
  maxEdge: number;
  alphaThreshold: number;
  dilation: number;
  rectSmoothingAlpha: number;
  asyncReadback: boolean;
};

export type DebugHitTestSettingsPayload = {
  showMouseDot?: boolean;
  maxEdge?: number;
  alphaThreshold?: number;
  dilation?: number;
  rectSmoothingAlpha?: number;
  asyncReadback?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const resolveHitTestMaskTuning = (
  tuning?: Partial<HitTestMaskTuning>
): HitTestMaskTuning => {
  const maxEdge = clamp(
    Math.round(tuning?.maxEdge ?? DEFAULT_HITTEST_MASK_MAX_EDGE),
    HITTEST_MASK_MAX_EDGE_MIN,
    HITTEST_MASK_MAX_EDGE_MAX
  );
  const alphaThreshold = clamp(
    Math.round(tuning?.alphaThreshold ?? DEFAULT_HITTEST_ALPHA_THRESHOLD),
    HITTEST_ALPHA_THRESHOLD_MIN,
    HITTEST_ALPHA_THRESHOLD_MAX
  );
  const dilation = clamp(
    Math.round(tuning?.dilation ?? DEFAULT_HITTEST_DILATION),
    HITTEST_DILATION_MIN,
    HITTEST_DILATION_MAX
  );
  const rectSmoothingAlpha = clamp(
    tuning?.rectSmoothingAlpha ?? DEFAULT_HITTEST_RECT_SMOOTH_ALPHA,
    HITTEST_RECT_SMOOTH_ALPHA_MIN,
    HITTEST_RECT_SMOOTH_ALPHA_MAX
  );
  const asyncReadback =
    typeof tuning?.asyncReadback === "boolean"
      ? tuning.asyncReadback
      : DEFAULT_HITTEST_ASYNC_READBACK;
  return { maxEdge, alphaThreshold, dilation, rectSmoothingAlpha, asyncReadback };
};

export const readStorageFlag = (key: string, fallback = false): boolean => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
};

export const readStorageNumber = (key: string, fallback: number): number => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const readHitTestDotFromStorage = (): boolean =>
  readStorageFlag(HITTEST_DOT_STORAGE_KEY);

export const readHitTestMaskTuningFromStorage = (): HitTestMaskTuning =>
  resolveHitTestMaskTuning({
    maxEdge: readStorageNumber(HITTEST_MASK_MAX_EDGE_KEY, DEFAULT_HITTEST_MASK_MAX_EDGE),
    alphaThreshold: readStorageNumber(
      HITTEST_ALPHA_THRESHOLD_KEY,
      DEFAULT_HITTEST_ALPHA_THRESHOLD
    ),
    dilation: readStorageNumber(HITTEST_DILATION_KEY, DEFAULT_HITTEST_DILATION),
    rectSmoothingAlpha: readStorageNumber(
      HITTEST_RECT_SMOOTH_ALPHA_KEY,
      DEFAULT_HITTEST_RECT_SMOOTH_ALPHA
    ),
    asyncReadback: readStorageFlag(HITTEST_ASYNC_READBACK_KEY, DEFAULT_HITTEST_ASYNC_READBACK),
  });

export const applyHitTestMaskTuningPatch = (
  prev: HitTestMaskTuning,
  patch?: Partial<HitTestMaskTuning>
): HitTestMaskTuning => {
  if (!patch) return prev;

  let changed = false;
  const next = { ...prev };

  if (typeof patch.maxEdge === "number" && Number.isFinite(patch.maxEdge)) {
    const value = clamp(
      Math.round(patch.maxEdge),
      HITTEST_MASK_MAX_EDGE_MIN,
      HITTEST_MASK_MAX_EDGE_MAX
    );
    if (value !== prev.maxEdge) {
      next.maxEdge = value;
      changed = true;
    }
  }

  if (typeof patch.alphaThreshold === "number" && Number.isFinite(patch.alphaThreshold)) {
    const value = clamp(
      Math.round(patch.alphaThreshold),
      HITTEST_ALPHA_THRESHOLD_MIN,
      HITTEST_ALPHA_THRESHOLD_MAX
    );
    if (value !== prev.alphaThreshold) {
      next.alphaThreshold = value;
      changed = true;
    }
  }

  if (typeof patch.dilation === "number" && Number.isFinite(patch.dilation)) {
    const value = clamp(Math.round(patch.dilation), HITTEST_DILATION_MIN, HITTEST_DILATION_MAX);
    if (value !== prev.dilation) {
      next.dilation = value;
      changed = true;
    }
  }

  if (
    typeof patch.rectSmoothingAlpha === "number" &&
    Number.isFinite(patch.rectSmoothingAlpha)
  ) {
    const value = clamp(
      patch.rectSmoothingAlpha,
      HITTEST_RECT_SMOOTH_ALPHA_MIN,
      HITTEST_RECT_SMOOTH_ALPHA_MAX
    );
    if (value !== prev.rectSmoothingAlpha) {
      next.rectSmoothingAlpha = value;
      changed = true;
    }
  }

  if (typeof patch.asyncReadback === "boolean" && patch.asyncReadback !== prev.asyncReadback) {
    next.asyncReadback = patch.asyncReadback;
    changed = true;
  }

  return changed ? next : prev;
};

export const writeStorageFlag = (key: string, value: boolean) => {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
};

export const writeStorageNumber = (key: string, value: number) => {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
};
