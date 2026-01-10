export type VmdMotionSettings = {
  enableIk: boolean;
  includeFingers: boolean;
  smoothingTauSeconds: number;
};

export const DEFAULT_VMD_MOTION_SETTINGS: VmdMotionSettings = {
  enableIk: true,
  includeFingers: false,
  smoothingTauSeconds: 0.12,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampFinite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export const clampVmdMotionSettings = (settings: VmdMotionSettings): VmdMotionSettings => ({
  enableIk: Boolean(settings.enableIk),
  includeFingers: Boolean(settings.includeFingers),
  smoothingTauSeconds: clamp(clampFinite(settings.smoothingTauSeconds, 0.12), 0.04, 0.3),
});

