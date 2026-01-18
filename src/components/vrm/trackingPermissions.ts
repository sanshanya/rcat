import type { VrmToolMode } from "@/components/vrm/vrmToolModeStore";

export type BehaviorContext = {
  motionActive: boolean;
  speaking: boolean;
  toolMode: VrmToolMode;
};

export type TrackingPermissionsTarget = {
  allowHead: boolean;
  allowSpine: boolean;
  allowEyes: boolean;
  headWeight: number;
  spineWeight: number;
  eyesWeight: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export type TrackingPermissionsApplied = Omit<
  TrackingPermissionsTarget,
  "headWeight" | "spineWeight" | "eyesWeight"
> & {
  headWeight: number;
  spineWeight: number;
  eyesWeight: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const moveTowards = (current: number, target: number, maxDelta: number) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

const stepWeight = (options: {
  current: number;
  target: number;
  delta: number;
  fadeInMs: number;
  fadeOutMs: number;
}) => {
  const { current, target, delta, fadeInMs, fadeOutMs } = options;
  if (delta <= 0) return clamp01(target);
  const fadeMs = target > current ? fadeInMs : fadeOutMs;
  if (!Number.isFinite(fadeMs) || fadeMs <= 0) return clamp01(target);
  const fadeSeconds = Math.max(0.001, fadeMs / 1000);
  return clamp01(moveTowards(current, target, delta / fadeSeconds));
};

export const computeTrackingPermissionsTarget = (
  context: BehaviorContext
): TrackingPermissionsTarget => {
  const fadeInMs = 180;
  const fadeOutMs = 240;

  if (context.motionActive) {
    return {
      allowHead: false,
      allowSpine: false,
      allowEyes: false,
      headWeight: 0,
      spineWeight: 0,
      eyesWeight: 0,
      fadeInMs,
      fadeOutMs,
    };
  }

  if (context.toolMode === "model") {
    return {
      allowHead: false,
      allowSpine: false,
      allowEyes: false,
      headWeight: 0,
      spineWeight: 0,
      eyesWeight: 0,
      fadeInMs,
      fadeOutMs,
    };
  }

  if (context.speaking) {
    return {
      allowHead: true,
      allowSpine: true,
      allowEyes: true,
      headWeight: 1,
      spineWeight: 1,
      eyesWeight: 1,
      fadeInMs,
      fadeOutMs,
    };
  }

  return {
    allowHead: true,
    allowSpine: true,
    allowEyes: true,
    headWeight: 1,
    spineWeight: 1,
    eyesWeight: 1,
    fadeInMs,
    fadeOutMs,
  };
};

export class TrackingPermissionController {
  private headWeight = 1;
  private spineWeight = 1;
  private eyesWeight = 1;

  update(delta: number, target: TrackingPermissionsTarget): TrackingPermissionsApplied {
    this.headWeight = stepWeight({
      current: this.headWeight,
      target: target.headWeight,
      delta,
      fadeInMs: target.fadeInMs,
      fadeOutMs: target.fadeOutMs,
    });
    this.spineWeight = stepWeight({
      current: this.spineWeight,
      target: target.spineWeight,
      delta,
      fadeInMs: target.fadeInMs,
      fadeOutMs: target.fadeOutMs,
    });
    this.eyesWeight = stepWeight({
      current: this.eyesWeight,
      target: target.eyesWeight,
      delta,
      fadeInMs: target.fadeInMs,
      fadeOutMs: target.fadeOutMs,
    });

    return {
      ...target,
      headWeight: this.headWeight,
      spineWeight: this.spineWeight,
      eyesWeight: this.eyesWeight,
    };
  }
}
