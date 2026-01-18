import type { Object3D } from "three";
import { Euler, MathUtils, Quaternion } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

import type { VrmToolMode } from "@/components/vrm/vrmToolModeStore";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class SpeechGestureController {
  private readonly head: Object3D | null;
  private readonly chest: Object3D | null;
  private readonly upperChest: Object3D | null;

  private energy = 0;
  private phase = 0;

  private readonly euler = new Euler();
  private readonly quat = new Quaternion();

  private static readonly ATTACK_SEC = 0.08;
  private static readonly RELEASE_SEC = 0.18;
  private static readonly MIN_ENERGY = 0.15;

  constructor(vrm: VRM) {
    const humanoid = vrm.humanoid;
    this.head =
      humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head) ??
      humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck) ??
      null;
    this.chest = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest) ?? null;
    this.upperChest =
      humanoid?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ?? null;
  }

  update(options: {
    delta: number;
    speaking: boolean;
    mouth: number;
    toolMode: VrmToolMode;
    motionActive: boolean;
  }): boolean {
    const { delta, speaking, mouth, toolMode, motionActive } = options;
    if (!Number.isFinite(delta) || delta <= 0) return false;

    const active = speaking || mouth > 0.001;
    const target = active ? Math.max(SpeechGestureController.MIN_ENERGY, mouth) : 0;
    const targetEnergy = clamp01(target);
    const tau =
      targetEnergy > this.energy
        ? SpeechGestureController.ATTACK_SEC
        : SpeechGestureController.RELEASE_SEC;
    const step = tau <= 0 ? 1 : 1 - Math.exp(-delta / tau);
    this.energy = clamp01(this.energy + (targetEnergy - this.energy) * step);

    if (motionActive) return false;
    if (toolMode === "model") return false;
    if (this.energy <= 0.001) return false;

    const rateHz = 2.2 + this.energy * 0.8;
    this.phase += delta * rateHz * Math.PI * 2;

    const energy = this.energy;
    const headPitch = Math.sin(this.phase) * MathUtils.degToRad(2.2) * energy;
    const headYaw = Math.sin(this.phase * 0.7 + 1.2) * MathUtils.degToRad(1.2) * energy;
    const headRoll = Math.sin(this.phase * 0.5 + 0.7) * MathUtils.degToRad(1.4) * energy;

    const chestPitch = Math.sin(this.phase * 0.65 + 0.3) * MathUtils.degToRad(0.9) * energy;
    const chestRoll = Math.sin(this.phase * 0.5 + 2.1) * MathUtils.degToRad(0.8) * energy;

    if (this.head) {
      this.euler.set(headPitch, headYaw, headRoll);
      this.quat.setFromEuler(this.euler);
      this.head.quaternion.multiply(this.quat);
    }

    if (this.upperChest) {
      this.euler.set(chestPitch * 0.7, 0, chestRoll * 0.7);
      this.quat.setFromEuler(this.euler);
      this.upperChest.quaternion.multiply(this.quat);
    } else if (this.chest) {
      this.euler.set(chestPitch, 0, chestRoll);
      this.quat.setFromEuler(this.euler);
      this.chest.quaternion.multiply(this.quat);
    }

    return true;
  }
}
