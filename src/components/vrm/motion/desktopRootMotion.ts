import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import { type AnimationClip, VectorKeyframeTrack } from "three";

const ORIGINAL_HIPS_POSITION_VALUES_KEY = "__rcatOriginalHipsPositionValues";

export type DesktopRootMotionPolicy = "remove-net-displacement" | "lock-horizontal";

/**
 * Desktop-pet friendly root motion policy:
 * - treat hips translation as root motion
 * - keep X/Z anchored in-place
 * - keep Y relative (jump/crouch still works)
 */
export function applyDesktopInPlaceRootMotion(
  clip: AnimationClip,
  vrm: VRM,
  policy: DesktopRootMotionPolicy = "remove-net-displacement",
  baseHipsPosition?: { x: number; y: number; z: number }
) {
  const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
  if (!hips) return;

  const trackName = `${hips.name}.position`;
  const track = clip.tracks.find((entry) => entry.name === trackName);
  if (!(track instanceof VectorKeyframeTrack)) return;

  const stored = clip.userData?.[ORIGINAL_HIPS_POSITION_VALUES_KEY];
  const original = stored instanceof Float32Array ? stored : Float32Array.from(track.values);
  if (!(stored instanceof Float32Array)) {
    clip.userData[ORIGINAL_HIPS_POSITION_VALUES_KEY] = original;
  }
  if (original.length < 3 || track.times.length < 2) return;

  const baseX = baseHipsPosition?.x ?? hips.position.x;
  const baseY = baseHipsPosition?.y ?? hips.position.y;
  const baseZ = baseHipsPosition?.z ?? hips.position.z;
  const x0 = original[0];
  const y0 = original[1];
  const z0 = original[2];
  const lastIndex = original.length - 3;
  const dxEnd = original[lastIndex] - x0;
  const dzEnd = original[lastIndex + 2] - z0;
  const t0 = track.times[0] ?? 0;
  const t1 = track.times[track.times.length - 1] ?? t0;
  const span = Math.max(1e-6, t1 - t0);

  const values = track.values;
  for (let key = 0; key < track.times.length; key += 1) {
    const i = key * 3;
    const dx = original[i] - x0;
    const dy = original[i + 1] - y0;
    const dz = original[i + 2] - z0;

    if (policy === "lock-horizontal") {
      values[i] = baseX;
      values[i + 1] = baseY + dy;
      values[i + 2] = baseZ;
      continue;
    }

    const alpha = Math.min(1, Math.max(0, (track.times[key] - t0) / span));

    // Remove the net displacement component (root motion), but keep the residual sway.
    values[i] = baseX + (dx - dxEnd * alpha);
    values[i + 1] = baseY + dy;
    values[i + 2] = baseZ + (dz - dzEnd * alpha);
  }
}
