export type VrmMouseTrackingPartSettings = {
  enabled: boolean;
  yawLimitDeg: number;
  pitchLimitDeg: number;
  smoothness: number;
  blend: number;
};

export type VrmSpineTrackingSettings = {
  enabled: boolean;
  minYawDeg: number;
  maxYawDeg: number;
  smoothness: number;
  fadeSpeed: number;
  falloff: number;
  blend: number;
};

export type VrmMouseTrackingSettings = {
  enabled: boolean;
  head: VrmMouseTrackingPartSettings;
  spine: VrmSpineTrackingSettings;
  eyes: VrmMouseTrackingPartSettings;
};

export const DEFAULT_VRM_MOUSE_TRACKING_SETTINGS: VrmMouseTrackingSettings = {
  enabled: true,
  head: {
    enabled: true,
    yawLimitDeg: 45,
    pitchLimitDeg: 30,
    smoothness: 10,
    blend: 0.9,
  },
  spine: {
    enabled: true,
    minYawDeg: -15,
    maxYawDeg: 15,
    smoothness: 16,
    fadeSpeed: 5,
    falloff: 0.8,
    blend: 0.65,
  },
  eyes: {
    enabled: true,
    yawLimitDeg: 12,
    pitchLimitDeg: 12,
    smoothness: 10,
    blend: 0.95,
  },
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clamp01 = (value: number) => clamp(value, 0, 1);

const clampFinite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export const clampMouseTrackingSettings = (
  settings: VrmMouseTrackingSettings
): VrmMouseTrackingSettings => {
  const head = settings.head;
  const spine = settings.spine;
  const eyes = settings.eyes;

  return {
    enabled: Boolean(settings.enabled),
    head: {
      enabled: Boolean(head.enabled),
      yawLimitDeg: clamp(clampFinite(head.yawLimitDeg, 45), 0, 90),
      pitchLimitDeg: clamp(clampFinite(head.pitchLimitDeg, 30), 0, 90),
      smoothness: clamp(clampFinite(head.smoothness, 10), 0, 60),
      blend: clamp01(clampFinite(head.blend, 0.9)),
    },
    spine: {
      enabled: Boolean(spine.enabled),
      minYawDeg: clamp(clampFinite(spine.minYawDeg, -15), -90, 90),
      maxYawDeg: clamp(clampFinite(spine.maxYawDeg, 15), -90, 90),
      smoothness: clamp(clampFinite(spine.smoothness, 16), 0, 80),
      fadeSpeed: clamp(clampFinite(spine.fadeSpeed, 5), 0, 20),
      falloff: clamp01(clampFinite(spine.falloff, 0.8)),
      blend: clamp01(clampFinite(spine.blend, 0.65)),
    },
    eyes: {
      enabled: Boolean(eyes.enabled),
      yawLimitDeg: clamp(clampFinite(eyes.yawLimitDeg, 12), 0, 90),
      pitchLimitDeg: clamp(clampFinite(eyes.pitchLimitDeg, 12), 0, 90),
      smoothness: clamp(clampFinite(eyes.smoothness, 10), 0, 60),
      blend: clamp01(clampFinite(eyes.blend, 0.95)),
    },
  };
};

