export type VrmHudPanelPosition = {
  x: number;
  y: number;
};

export type VrmHudLayoutSettings = {
  locked: boolean;
  debugPanel: VrmHudPanelPosition | null;
};

export const DEFAULT_VRM_HUD_LAYOUT_SETTINGS: VrmHudLayoutSettings = {
  locked: false,
  debugPanel: null,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampFinite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const clampPos = (pos: VrmHudPanelPosition): VrmHudPanelPosition => ({
  x: clamp(clampFinite(pos.x, 0), -10000, 10000),
  y: clamp(clampFinite(pos.y, 0), -10000, 10000),
});

export const clampHudLayoutSettings = (settings: VrmHudLayoutSettings): VrmHudLayoutSettings => ({
  locked: Boolean(settings.locked),
  debugPanel: settings.debugPanel ? clampPos(settings.debugPanel) : null,
});

