export type AvatarHitTestMaskRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type AvatarHitTestMaskRuntime = {
  maskW: number;
  maskH: number;
  stride: number;
  rect: AvatarHitTestMaskRect;
  bitset: Uint8Array;
  updatedAtMs: number;
};

let current: AvatarHitTestMaskRuntime | null = null;

export const setAvatarHitTestMaskRuntime = (next: AvatarHitTestMaskRuntime | null) => {
  current = next;
};

export const getAvatarHitTestMaskRuntime = () => current;

export const hitTestAvatarMaskAtNdc = (pointer: { x: number; y: number } | null): boolean => {
  if (!pointer) return false;
  const { x, y } = pointer;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < -1 || x > 1 || y < -1 || y > 1) return false;

  const snapshot = current;
  if (!snapshot) return false;
  const { maskW, maskH, stride, rect, bitset } = snapshot;
  if (maskW <= 0 || maskH <= 0 || stride <= 0) return false;
  if (rect.maxX <= rect.minX || rect.maxY <= rect.minY) return false;
  if (!bitset || bitset.length < stride * maskH) return false;

  const mx = Math.floor(((x + 1) * 0.5) * maskW);
  const my = Math.floor(((1 - y) * 0.5) * maskH);
  if (mx < rect.minX || mx >= rect.maxX || my < rect.minY || my >= rect.maxY) return false;
  if (mx < 0 || my < 0 || mx >= maskW || my >= maskH) return false;

  const idx = my * stride + (mx >> 3);
  const byte = bitset[idx];
  if (byte === undefined) return false;
  return ((byte >> (mx & 7)) & 1) === 1;
};

