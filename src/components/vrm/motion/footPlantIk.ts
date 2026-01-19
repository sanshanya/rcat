import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import { Object3D, Vector3 } from "three";

import VRMIKHandler from "@/components/vrm/motion/vmd/vrmIkHandler";

type FootName = typeof VRMHumanBoneName.LeftFoot | typeof VRMHumanBoneName.RightFoot;
type ToeName = typeof VRMHumanBoneName.LeftToes | typeof VRMHumanBoneName.RightToes;

type FootState = {
  footName: FootName;
  toeName: ToeName;
  foot: Object3D | null;
  toe: Object3D | null;
  footTarget: Object3D | null;
  toeTarget: Object3D | null;
  locked: boolean;
  lockFootWorldPos: Vector3;
  lockToeWorldPos: Vector3;
  lastContactY: number;
  lastHeight: number;
  lastVerticalSpeed: number;
  hasLast: boolean;
};

export type FootPlantIkTuning = {
  enabled: boolean;
  lockHeight: number;
  unlockHeight: number;
  lockVerticalSpeed: number;
  unlockVerticalSpeed: number;
};

export type FootPlantIkDebugInfo = {
  enabled: boolean;
  floorY: number | null;
  tuning: FootPlantIkTuning;
  left: {
    locked: boolean;
    height: number | null;
    verticalSpeed: number | null;
  };
  right: {
    locked: boolean;
    height: number | null;
    verticalSpeed: number | null;
  };
};

const tempFootWorld = new Vector3();
const tempToeWorld = new Vector3();
const tempLocal = new Vector3();
const tempDesiredFoot = new Vector3();
const tempDesiredToe = new Vector3();

export class FootPlantIkController {
  private vrm: VRM;
  private ik: VRMIKHandler | null = null;
  private tuning: FootPlantIkTuning;
  private floorY: number | null = null;
  private left: FootState;
  private right: FootState;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    const hipsY = vrm.humanoid?.getNormalizedAbsolutePose().hips?.position?.[1];
    const scale = typeof hipsY === "number" && Number.isFinite(hipsY) && hipsY > 0 ? hipsY : 1;
    this.tuning = {
      enabled: true,
      // Many rigs place the foot bone at/near the ankle. Use toes + some slack.
      lockHeight: 0.05 * scale,
      unlockHeight: 0.085 * scale,
      // We lock based on vertical motion (horizontal drift is what we want to fix).
      lockVerticalSpeed: 0.18 * scale,
      unlockVerticalSpeed: 0.35 * scale,
    };
    this.left = this.createFootState(VRMHumanBoneName.LeftFoot, VRMHumanBoneName.LeftToes);
    this.right = this.createFootState(VRMHumanBoneName.RightFoot, VRMHumanBoneName.RightToes);
  }

  public primeFromCurrentPose() {
    if (!this.tuning.enabled) return;
    if (!this.vrm.humanoid) return;
    const ik = (this.ik ??= VRMIKHandler.get(this.vrm));
    this.ensureFootReady(this.left, ik);
    this.ensureFootReady(this.right, ik);
    if (!this.left.foot || !this.right.foot) return;

    this.vrm.scene.updateMatrixWorld(true);

    const leftFootWorld = this.left.foot.getWorldPosition(tempFootWorld).clone();
    const leftToeWorld = (this.left.toe ?? this.left.foot).getWorldPosition(tempToeWorld).clone();
    const rightFootWorld = this.right.foot.getWorldPosition(tempFootWorld).clone();
    const rightToeWorld = (this.right.toe ?? this.right.foot).getWorldPosition(tempToeWorld).clone();

    this.floorY = Math.min(leftFootWorld.y, leftToeWorld.y, rightFootWorld.y, rightToeWorld.y);

    this.primeFoot(this.left, leftFootWorld, leftToeWorld);
    this.primeFoot(this.right, rightFootWorld, rightToeWorld);
  }

  public setEnabled(enabled: boolean) {
    this.tuning.enabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  public getDebugInfo(): FootPlantIkDebugInfo {
    return {
      enabled: this.tuning.enabled,
      floorY: this.floorY,
      tuning: { ...this.tuning },
      left: {
        locked: this.left.locked,
        height: this.left.hasLast && this.floorY !== null ? this.left.lastHeight : null,
        verticalSpeed: this.left.hasLast ? this.left.lastVerticalSpeed : null,
      },
      right: {
        locked: this.right.locked,
        height: this.right.hasLast && this.floorY !== null ? this.right.lastHeight : null,
        verticalSpeed: this.right.hasLast ? this.right.lastVerticalSpeed : null,
      },
    };
  }

  public reset() {
    this.floorY = null;
    this.resetFoot(this.left);
    this.resetFoot(this.right);
  }

  public update(delta: number) {
    if (!this.tuning.enabled) return;
    const vrm = this.vrm;
    if (!vrm.humanoid) return;
    const ik = (this.ik ??= VRMIKHandler.get(vrm));

    this.ensureFootReady(this.left, ik);
    this.ensureFootReady(this.right, ik);
    if (!this.left.foot || !this.right.foot) return;

    vrm.scene.updateMatrixWorld(true);

    if (this.floorY === null) {
      const leftFootY = this.left.foot.getWorldPosition(tempFootWorld).y;
      const leftToeY = (this.left.toe ?? this.left.foot).getWorldPosition(tempToeWorld).y;
      const rightFootY = this.right.foot.getWorldPosition(tempFootWorld).y;
      const rightToeY = (this.right.toe ?? this.right.foot).getWorldPosition(tempToeWorld).y;
      this.floorY = Math.min(leftFootY, leftToeY, rightFootY, rightToeY);
    }

    this.updateFoot(this.left, delta);
    this.updateFoot(this.right, delta);

    vrm.scene.updateMatrixWorld(true);
    ik.update();
  }

  private createFootState(footName: FootName, toeName: ToeName): FootState {
    return {
      footName,
      toeName,
      foot: null,
      toe: null,
      footTarget: null,
      toeTarget: null,
      locked: false,
      lockFootWorldPos: new Vector3(),
      lockToeWorldPos: new Vector3(),
      lastContactY: 0,
      lastHeight: 0,
      lastVerticalSpeed: 0,
      hasLast: false,
    };
  }

  private resetFoot(state: FootState) {
    state.locked = false;
    state.lastHeight = 0;
    state.lastVerticalSpeed = 0;
    state.hasLast = false;
  }

  private primeFoot(state: FootState, footWorldPos: Vector3, toeWorldPos: Vector3) {
    const footTarget = state.footTarget;
    if (!footTarget) return;
    const contactY = Math.min(footWorldPos.y, toeWorldPos.y);
    state.lastContactY = contactY;
    state.lastHeight = 0;
    state.lastVerticalSpeed = 0;
    state.locked = false;
    state.lockFootWorldPos.copy(footWorldPos);
    state.lockToeWorldPos.copy(toeWorldPos);
    state.hasLast = true;
    this.setTargetWorldPosition(footTarget, footWorldPos);
    if (state.toeTarget) {
      this.setTargetWorldPosition(state.toeTarget, toeWorldPos);
    }
  }

  private ensureFootReady(state: FootState, ik: VRMIKHandler) {
    if (!state.foot) {
      state.foot = this.vrm.humanoid?.getNormalizedBoneNode(state.footName) ?? null;
    }
    if (!state.toe) {
      state.toe = this.vrm.humanoid?.getNormalizedBoneNode(state.toeName) ?? null;
    }
    // Motion switching (e.g. VMD IK) may disable all IK links globally. Always re-enable the
    // chains we rely on, even if targets were already created/cached.
    state.footTarget = ik.getAndEnableIK(state.footName) ?? null;
    state.toeTarget = ik.getAndEnableIK(state.toeName) ?? null;
  }

  private updateFoot(state: FootState, delta: number) {
    const foot = state.foot;
    const toe = state.toe;
    const footTarget = state.footTarget;
    const toeTarget = state.toeTarget;
    const floorY = this.floorY;
    if (!foot || !footTarget || floorY === null) return;

    const footWorldPos = foot.getWorldPosition(tempFootWorld);
    const toeWorldPos = (toe ?? foot).getWorldPosition(tempToeWorld);
    const contactY = Math.min(footWorldPos.y, toeWorldPos.y);
    if (!state.hasLast) {
      this.primeFoot(state, footWorldPos, toeWorldPos);
      return;
    }

    const dt = Math.max(1e-3, delta);
    const verticalSpeed = Math.abs(contactY - state.lastContactY) / dt;
    state.lastContactY = contactY;

    const height = contactY - floorY;
    state.lastHeight = height;
    state.lastVerticalSpeed = verticalSpeed;
    if (state.locked) {
      if (height > this.tuning.unlockHeight || verticalSpeed > this.tuning.unlockVerticalSpeed) {
        state.locked = false;
      }
    } else {
      if (height < this.tuning.lockHeight && verticalSpeed < this.tuning.lockVerticalSpeed) {
        state.locked = true;
        state.lockFootWorldPos.copy(footWorldPos);
        state.lockToeWorldPos.copy(toeWorldPos);
      }
    }

    // Locking Y makes legs feel "cushioned" when the hips moves (breathing / sway).
    // For desktop pet we mainly care about horizontal foot sliding, so keep Y from animation.
    const desiredFoot = state.locked
      ? tempDesiredFoot.copy(footWorldPos).setX(state.lockFootWorldPos.x).setZ(state.lockFootWorldPos.z)
      : footWorldPos;
    const desiredToe = state.locked
      ? tempDesiredToe.copy(toeWorldPos).setX(state.lockToeWorldPos.x).setZ(state.lockToeWorldPos.z)
      : toeWorldPos;
    this.setTargetWorldPosition(footTarget, desiredFoot);
    if (toeTarget) {
      this.setTargetWorldPosition(toeTarget, desiredToe);
    }
  }

  private setTargetWorldPosition(target: Object3D, worldPos: Vector3) {
    const parent = target.parent ?? this.vrm.scene;
    tempLocal.copy(worldPos);
    parent.worldToLocal(tempLocal);
    target.position.copy(tempLocal);
  }
}
