import type { Object3D, PerspectiveCamera } from "three";
import { Euler, MathUtils, Quaternion, Vector2, Vector3 } from "three";
import { VRMHumanBoneName, type VRM, type VRMSpringBoneJoint } from "@pixiv/three-vrm";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const moveTowards = (current: number, target: number, maxDelta: number) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

const spring = (options: {
  x: number;
  v: number;
  target: number;
  frequency: number;
  dampingRatio: number;
  delta: number;
}) => {
  const { target, dampingRatio, delta } = options;
  const w = Math.max(0.01, options.frequency) * Math.PI * 2;
  const a = w * w * (target - options.x) - 2 * dampingRatio * w * options.v;
  const v = options.v + a * delta;
  const x = options.x + v * delta;
  return { x, v };
};

export class AvatarDragSwayController {
  private readonly hips: Object3D | null;
  private readonly springJoints: VRMSpringBoneJoint[] = [];
  private readonly springBaseGravity: Vector3[] = [];

  private leanZ = 0;
  private leanZVel = 0;
  private leanX = 0;
  private leanXVel = 0;
  private effectWeight = 0;

  private readonly filteredDelta = new Vector2();
  private readonly euler = new Euler();
  private readonly quat = new Quaternion();
  private readonly windCurrent = new Vector3();
  private readonly windTarget = new Vector3();
  private readonly windCombined = new Vector3();
  private readonly camQuat = new Quaternion();
  private readonly camRight = new Vector3();
  private readonly camUp = new Vector3();
  private springDirty = false;

  private static readonly FILTER_RATE = 12;
  private static readonly HORIZONTAL_TO_LEAN = 0.15;
  private static readonly VERTICAL_TO_PITCH = 0.15;
  private static readonly MAX_ROLL_DEG = 15;
  private static readonly MAX_PITCH_DEG = 12;
  private static readonly SPRING_FREQUENCY = 2.6;
  private static readonly DAMPING_RATIO = 0.35;
  private static readonly BLEND_SPEED = 8;

  // Window drag -> spring-bone wind (makes hair/cloth react even when moving the window).
  private static readonly WIND_ATTACK_SEC = 0.08;
  private static readonly WIND_RELEASE_SEC = 0.18;
  private static readonly WIND_VELOCITY_TO_GRAVITY = 0.0008; // px/sec -> gravity power
  private static readonly WIND_MAX_GRAVITY = 1.2;

  constructor(vrm: VRM) {
    this.hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
    const manager = vrm.springBoneManager;
    if (manager) {
      this.springJoints = Array.from(manager.joints);
      this.springBaseGravity = this.springJoints.map((joint) => {
        const dir = joint.settings.gravityDir?.clone?.() ?? new Vector3(0, -1, 0);
        const power =
          typeof joint.settings.gravityPower === "number" && Number.isFinite(joint.settings.gravityPower)
            ? joint.settings.gravityPower
            : 0;
        return dir.multiplyScalar(power);
      });
    }
  }

  update(options: {
    delta: number;
    dragging: boolean;
    dragDeltaPx: { x: number; y: number };
    motionActive: boolean;
    camera: PerspectiveCamera | null;
    applySpringWind: boolean;
  }): boolean {
    const { delta, dragging, dragDeltaPx, motionActive, camera, applySpringWind } = options;
    if (!this.hips) return false;
    if (!Number.isFinite(delta) || delta <= 0) return false;

    const dt = Math.min(0.06, delta);
    const active = dragging && !motionActive;

    const desiredDelta = active ? dragDeltaPx : { x: 0, y: 0 };
    const lerpFactor = 1 - Math.exp(-AvatarDragSwayController.FILTER_RATE * dt);
    this.filteredDelta.x += (desiredDelta.x - this.filteredDelta.x) * lerpFactor;
    this.filteredDelta.y += (desiredDelta.y - this.filteredDelta.y) * lerpFactor;

    // Positive X delta (window moved right) should lean left, so horizontal sign = -1.
    const signH = -1;
    const signV = 1;
    const targetLeanZ = clamp(
      signH * this.filteredDelta.x * AvatarDragSwayController.HORIZONTAL_TO_LEAN,
      -AvatarDragSwayController.MAX_ROLL_DEG,
      AvatarDragSwayController.MAX_ROLL_DEG
    );
    const targetLeanX = clamp(
      signV * this.filteredDelta.y * AvatarDragSwayController.VERTICAL_TO_PITCH,
      -AvatarDragSwayController.MAX_PITCH_DEG,
      AvatarDragSwayController.MAX_PITCH_DEG
    );

    {
      const next = spring({
        x: this.leanZ,
        v: this.leanZVel,
        target: active ? targetLeanZ : 0,
        frequency: AvatarDragSwayController.SPRING_FREQUENCY,
        dampingRatio: AvatarDragSwayController.DAMPING_RATIO,
        delta: dt,
      });
      this.leanZ = next.x;
      this.leanZVel = next.v;
    }
    {
      const next = spring({
        x: this.leanX,
        v: this.leanXVel,
        target: active ? targetLeanX : 0,
        frequency: AvatarDragSwayController.SPRING_FREQUENCY,
        dampingRatio: AvatarDragSwayController.DAMPING_RATIO,
        delta: dt,
      });
      this.leanX = next.x;
      this.leanXVel = next.v;
    }

    const outSpeed = active
      ? AvatarDragSwayController.BLEND_SPEED
      : AvatarDragSwayController.BLEND_SPEED * 2;
    this.effectWeight = clamp(
      moveTowards(this.effectWeight, active ? 1 : 0, outSpeed * dt),
      0,
      1
    );

    const xH = MathUtils.degToRad(this.leanX * this.effectWeight);
    const zH = MathUtils.degToRad(this.leanZ * this.effectWeight);

    this.updateSpringWind({
      delta: dt,
      active,
      dragDeltaPx,
      camera,
      applySpringWind,
    });

    const hasSway = Math.abs(xH) > 1e-5 || Math.abs(zH) > 1e-5;
    if (!hasSway) {
      return false;
    }

    this.euler.set(xH, 0, zH);
    this.quat.setFromEuler(this.euler);
    this.hips.quaternion.multiply(this.quat);
    return true;
  }

  private updateSpringWind(options: {
    delta: number;
    active: boolean;
    dragDeltaPx: { x: number; y: number };
    camera: PerspectiveCamera | null;
    applySpringWind: boolean;
  }) {
    const { delta, active, dragDeltaPx, camera, applySpringWind } = options;
    if (!camera) return;
    if (this.springJoints.length === 0) return;

    this.windTarget.set(0, 0, 0);
    if (active && applySpringWind) {
      const vx = dragDeltaPx.x / Math.max(1e-3, delta);
      const vy = dragDeltaPx.y / Math.max(1e-3, delta);

      camera.getWorldQuaternion(this.camQuat);
      this.camRight.set(1, 0, 0).applyQuaternion(this.camQuat).normalize();
      this.camUp.set(0, 1, 0).applyQuaternion(this.camQuat).normalize();

      // Inertia: move right => pull left, move down => pull up.
      this.windTarget
        .copy(this.camRight)
        .multiplyScalar(-vx)
        .addScaledVector(this.camUp, vy);

      const speed = this.windTarget.length();
      if (speed > 1e-3) {
        const power = clamp(
          speed * AvatarDragSwayController.WIND_VELOCITY_TO_GRAVITY,
          0,
          AvatarDragSwayController.WIND_MAX_GRAVITY
        );
        this.windTarget.multiplyScalar(power / speed);
      } else {
        this.windTarget.set(0, 0, 0);
      }
    }

    const targetMag = this.windTarget.length();
    const currentMag = this.windCurrent.length();
    const tau =
      targetMag > currentMag
        ? AvatarDragSwayController.WIND_ATTACK_SEC
        : AvatarDragSwayController.WIND_RELEASE_SEC;
    const step = tau <= 0 ? 1 : 1 - Math.exp(-delta / tau);
    this.windCurrent.lerp(this.windTarget, step);

    const windSq = this.windCurrent.lengthSq();
    if (windSq > 1e-6) {
      this.springDirty = true;
    }

    if (!applySpringWind && !this.springDirty) {
      return;
    }

    for (let i = 0; i < this.springJoints.length; i += 1) {
      const joint = this.springJoints[i];
      const base = this.springBaseGravity[i];
      this.windCombined.copy(base).add(this.windCurrent);
      const len = this.windCombined.length();
      if (len <= 1e-6) {
        joint.settings.gravityPower = 0;
        joint.settings.gravityDir.set(0, -1, 0);
        continue;
      }
      joint.settings.gravityPower = len;
      joint.settings.gravityDir.copy(this.windCombined).multiplyScalar(1 / len);
    }

    if (windSq <= 1e-6 && !applySpringWind) {
      this.springDirty = false;
    }
  }
}
