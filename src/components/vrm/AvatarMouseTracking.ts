import type { Object3D } from "three";
import {
  AnimationClip,
  Euler,
  MathUtils,
  type PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

import type { RestPoseMap } from "@/components/vrm/idleMotion";
import type { VrmMouseTrackingSettings } from "@/components/vrm/mouseTrackingTypes";

type Vec2 = { x: number; y: number };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const moveTowards = (current: number, target: number, maxDelta: number) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

const slerpFactor = (smoothness: number, delta: number) => {
  if (!Number.isFinite(smoothness) || smoothness <= 0) return 1;
  return clamp01(1 - Math.exp(-smoothness * delta));
};

const trackTargetsFromClip = (clip: AnimationClip | null) => {
  const set = new Set<string>();
  if (!clip) return set;
  clip.tracks.forEach((track) => {
    const dot = track.name.indexOf(".");
    if (dot <= 0) return;
    const target = track.name.slice(0, dot);
    if (target) set.add(target);
  });
  return set;
};

export class AvatarMouseTracking {
  private readonly vrm: VRM;
  private restPose: RestPoseMap | null;
  private animatedTargets = new Set<string>();
  private lookAtTargetBackup: Object3D | null = null;
  private allowRestPoseOverride = true;

  private readonly raycaster = new Raycaster();
  private readonly tmpVec2 = new Vector2();

  // IMPORTANT: do not "guess" yaw/pitch sign by flipping constants.
  // Different VRM rigs can have different forward-axis conventions for head/eyes.
  // We calibrate per rig once using the camera right/up basis to avoid repeated inversions.
  private headYawSign: 1 | -1 = 1;
  private headPitchSign: 1 | -1 = 1;
  private headSignsInitialized = false;
  private eyesYawSign: 1 | -1 = 1;
  private eyesPitchSign: 1 | -1 = 1;
  private eyesSignsInitialized = false;

  private readonly headBone: Object3D | null;
  private readonly headBoneName: VRMHumanBoneName | null;
  private readonly spineBone: Object3D | null;
  private readonly chestBone: Object3D | null;
  private readonly upperChestBone: Object3D | null;
  private readonly leftEyeBone: Object3D | null;
  private readonly rightEyeBone: Object3D | null;

  private readonly headInitRot = new Quaternion();
  private readonly spineInitRot = new Quaternion();
  private readonly leftEyeInitRot = new Quaternion();
  private readonly rightEyeInitRot = new Quaternion();

  private readonly headDriverRot = new Quaternion();
  private readonly spineDriverRot = new Quaternion();
  private readonly leftEyeDriverRot = new Quaternion();
  private readonly rightEyeDriverRot = new Quaternion();

  private spineTrackingWeight = 0;

  private readonly euler = new Euler();
  private readonly tmpQuatA = new Quaternion();
  private readonly tmpQuatB = new Quaternion();
  private readonly tmpQuatC = new Quaternion();
  private readonly tmpQuatDir = new Quaternion();
  private readonly tmpVecA = new Vector3();
  private readonly tmpVecB = new Vector3();
  private readonly tmpVecC = new Vector3();
  private readonly tmpVecD = new Vector3();
  private readonly tmpVecE = new Vector3();

  constructor(vrm: VRM, restPose: RestPoseMap | null) {
    this.vrm = vrm;
    this.restPose = restPose;

    const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head) ?? null;
    const neck = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck) ?? null;
    this.headBone = head ?? neck;
    this.headBoneName = head ? VRMHumanBoneName.Head : neck ? VRMHumanBoneName.Neck : null;
    this.spineBone = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine) ?? null;
    this.chestBone = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest) ?? null;
    this.upperChestBone =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ?? null;
    this.leftEyeBone = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftEye) ?? null;
    this.rightEyeBone =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightEye) ?? null;

    if (this.headBone) {
      this.headInitRot.copy(this.headBone.quaternion);
      this.headDriverRot.copy(this.headInitRot);
    }
    if (this.spineBone) {
      this.spineInitRot.copy(this.spineBone.quaternion);
      this.spineDriverRot.copy(this.spineInitRot);
    }
    if (this.leftEyeBone) {
      this.leftEyeInitRot.copy(this.leftEyeBone.quaternion);
      this.leftEyeDriverRot.copy(this.leftEyeInitRot);
    }
    if (this.rightEyeBone) {
      this.rightEyeInitRot.copy(this.rightEyeBone.quaternion);
      this.rightEyeDriverRot.copy(this.rightEyeInitRot);
    }
  }

  setRestPose(restPose: RestPoseMap | null) {
    this.restPose = restPose;
  }

  setAnimatedClip(clip: AnimationClip | null) {
    this.animatedTargets = trackTargetsFromClip(clip);
  }

  private isAnimated(node: Object3D | null) {
    if (!node) return false;
    return this.animatedTargets.has(node.uuid) || this.animatedTargets.has(node.name);
  }

  private getBaseRotation(node: Object3D, boneName: VRMHumanBoneName) {
    const restQuat = this.restPose?.get(boneName) ?? null;
    if (this.allowRestPoseOverride && restQuat && !this.isAnimated(node)) {
      node.quaternion.copy(restQuat);
    }
    return node.quaternion;
  }

  private computeYawPitchDegrees(pointer: Vec2, yawLimitDeg: number, pitchLimitDeg: number) {
    const yaw = MathUtils.clamp(pointer.x * yawLimitDeg, -yawLimitDeg, yawLimitDeg);
    const pitch = MathUtils.clamp(pointer.y * pitchLimitDeg, -pitchLimitDeg, pitchLimitDeg);
    return { yaw, pitch };
  }

  private computeYawPitchFromCameraPointer(options: {
    pointer: Vec2;
    camera: PerspectiveCamera;
    yawLimitDeg: number;
    pitchLimitDeg: number;
  }) {
    const { pointer, camera, yawLimitDeg, pitchLimitDeg } = options;

    // Convert pointer into a view-ray direction, then scale the view angles to per-bone limits.
    this.tmpVec2.set(pointer.x, pointer.y);
    this.raycaster.setFromCamera(this.tmpVec2, camera);

    camera.getWorldQuaternion(this.tmpQuatA);
    const camRight = this.tmpVecA.set(1, 0, 0).applyQuaternion(this.tmpQuatA);
    const camUp = this.tmpVecB.set(0, 1, 0).applyQuaternion(this.tmpQuatA);
    const camForward = camera.getWorldDirection(this.tmpVecC);
    const rayDir = this.raycaster.ray.direction;

    const x = rayDir.dot(camRight);
    const y = rayDir.dot(camUp);
    const z = rayDir.dot(camForward);

    const yawAngleRad = Math.atan2(x, z);
    const pitchAngleRad = Math.atan2(y, z);

    const vHalfFovRad = MathUtils.degToRad(camera.fov) * 0.5;
    const hHalfFovRad = Math.atan(Math.tan(vHalfFovRad) * camera.aspect);

    const yawNorm = hHalfFovRad > 1e-6 ? yawAngleRad / hHalfFovRad : 0;
    const pitchNorm = vHalfFovRad > 1e-6 ? pitchAngleRad / vHalfFovRad : 0;

    const yaw = MathUtils.clamp(yawNorm, -1, 1) * yawLimitDeg;
    const pitch = MathUtils.clamp(pitchNorm, -1, 1) * pitchLimitDeg;
    return { yaw, pitch };
  }

  private calibrateSignsForNode(options: {
    node: Object3D;
    parent: Object3D;
    camera: PerspectiveCamera;
  }): { yawSign: 1 | -1; pitchSign: 1 | -1 } {
    const { node, parent, camera } = options;

    this.vrm.scene.updateMatrixWorld(true);
    node.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    camera.getWorldQuaternion(this.tmpQuatA);
    const camRightWorld = this.tmpVecA.set(1, 0, 0).applyQuaternion(this.tmpQuatA).normalize();
    const camUpWorld = this.tmpVecB.set(0, 1, 0).applyQuaternion(this.tmpQuatA).normalize();

    const nodePos = node.getWorldPosition(this.tmpVecD);
    const toCam = camera.getWorldPosition(this.tmpVecE).sub(nodePos);
    if (toCam.lengthSq() < 1e-8) {
      return { yawSign: 1, pitchSign: 1 };
    }
    toCam.normalize();

    // Use whichever of ±local(+Z) points toward the camera as the "visual forward".
    const visualForwardWorld = node.getWorldDirection(this.tmpVecC);
    if (visualForwardWorld.lengthSq() < 1e-8) {
      return { yawSign: 1, pitchSign: 1 };
    }
    visualForwardWorld.normalize();
    if (visualForwardWorld.dot(toCam) < 0) {
      visualForwardWorld.multiplyScalar(-1);
    }

    const parentWorldQuat = parent.getWorldQuaternion(this.tmpQuatB);
    const invParentWorldQuat = this.tmpQuatDir.copy(parentWorldQuat).invert();
    const forwardParent = this.tmpVecD.copy(visualForwardWorld).applyQuaternion(invParentWorldQuat);

    const eps = MathUtils.degToRad(5);

    // Positive yaw should move the visual forward towards camera-right.
    this.tmpQuatA.setFromAxisAngle(this.tmpVecE.set(0, 1, 0), eps);
    const yawForwardWorld = this.tmpVecE
      .copy(forwardParent)
      .applyQuaternion(this.tmpQuatA)
      .applyQuaternion(parentWorldQuat);
    const yawDeltaWorld = yawForwardWorld.sub(visualForwardWorld);
    const yawSign: 1 | -1 = yawDeltaWorld.dot(camRightWorld) >= 0 ? 1 : -1;

    // Positive pitch should move the visual forward towards camera-up.
    this.tmpQuatA.setFromAxisAngle(this.tmpVecE.set(1, 0, 0), eps);
    const pitchForwardWorld = this.tmpVecE
      .copy(forwardParent)
      .applyQuaternion(this.tmpQuatA)
      .applyQuaternion(parentWorldQuat);
    const pitchDeltaWorld = pitchForwardWorld.sub(visualForwardWorld);
    const pitchSign: 1 | -1 = pitchDeltaWorld.dot(camUpWorld) >= 0 ? 1 : -1;

    return { yawSign, pitchSign };
  }

  private ensureHeadSigns(camera: PerspectiveCamera | null) {
    if (this.headSignsInitialized) return;
    if (!camera || !this.headBone) return;
    const parent = this.headBone.parent ?? this.headBone;
    const signs = this.calibrateSignsForNode({ node: this.headBone, parent, camera });
    this.headYawSign = signs.yawSign;
    this.headPitchSign = signs.pitchSign;
    this.headSignsInitialized = true;
  }

  private ensureEyeSigns(camera: PerspectiveCamera | null) {
    if (this.eyesSignsInitialized) return;
    if (!camera || !this.leftEyeBone || !this.rightEyeBone) return;
    const parent = this.leftEyeBone.parent ?? this.rightEyeBone.parent ?? this.leftEyeBone;
    const signs = this.calibrateSignsForNode({ node: this.leftEyeBone, parent, camera });
    this.eyesYawSign = signs.yawSign;
    this.eyesPitchSign = signs.pitchSign;
    this.eyesSignsInitialized = true;
  }

  private handleHeadTracking(options: {
    delta: number;
    time: number;
    pointer: Vec2;
    camera: PerspectiveCamera | null;
    settings: VrmMouseTrackingSettings;
    weight: number;
  }) {
    const { delta, time, pointer, camera, settings, weight } = options;
    const head = this.headBone;
    const headBoneName = this.headBoneName;
    if (!head || !headBoneName) return;

    const headSettings = settings.head;
    const enabled = settings.enabled && headSettings.enabled;
    const applied = enabled ? clamp01(headSettings.blend) * clamp01(weight) : 0;
    const active = enabled && applied > 0.001;

    const idleYawDeg = active ? Math.sin(time * 0.8 + 1.2) * 2.0 : 0;
    const idlePitchDeg = active ? Math.sin(time * 1.15) * 1.6 : 0;
    const idleRollDeg = active ? Math.sin(time * 0.9 + 2.4) * 0.8 : 0;

    const baseYawPitch = enabled
      ? camera
        ? this.computeYawPitchFromCameraPointer({
            pointer,
            camera,
            yawLimitDeg: headSettings.yawLimitDeg,
            pitchLimitDeg: headSettings.pitchLimitDeg,
          })
        : this.computeYawPitchDegrees(pointer, headSettings.yawLimitDeg, headSettings.pitchLimitDeg)
      : { yaw: 0, pitch: 0 };
    this.ensureHeadSigns(camera);
    const yaw = baseYawPitch.yaw;
    const pitch = baseYawPitch.pitch;
    const yawRad = MathUtils.degToRad(this.headYawSign * (yaw + idleYawDeg));
    const pitchRad = MathUtils.degToRad(this.headPitchSign * (pitch + idlePitchDeg));
    const rollRad = MathUtils.degToRad(idleRollDeg);

    this.euler.set(pitchRad, yawRad, rollRad, "YXZ");
    this.tmpQuatA.setFromEuler(this.euler); // delta
    this.tmpQuatB.copy(this.headInitRot).premultiply(this.tmpQuatA); // delta * init

    const alpha = slerpFactor(headSettings.smoothness, delta);
    this.headDriverRot.slerp(this.tmpQuatB, alpha);

    // delta = driver * inverse(init)
    this.tmpQuatA.copy(this.headInitRot).invert();
    this.tmpQuatC.copy(this.headDriverRot).multiply(this.tmpQuatA);

    const base = this.getBaseRotation(head, headBoneName);
    this.tmpQuatB.copy(base).premultiply(this.tmpQuatC);
    head.quaternion.copy(base).slerp(this.tmpQuatB, applied);
  }

  private handleSpineTracking(options: {
    delta: number;
    pointer: Vec2 | null;
    weight: number;
    settings: VrmMouseTrackingSettings;
    allowed: boolean;
  }) {
    const { delta, pointer, weight, settings, allowed } = options;
    const spine = this.spineBone;
    if (!spine) return;

    const spineSettings = settings.spine;
    const enabled = settings.enabled && spineSettings.enabled && allowed;

    const targetWeight = enabled && pointer ? clamp01(weight) : 0;
    this.spineTrackingWeight = moveTowards(
      this.spineTrackingWeight,
      targetWeight,
      delta * spineSettings.fadeSpeed
    );
    const targetYawDeg = (() => {
      if (!enabled || !pointer) return 0.0;
      const normX = MathUtils.clamp(pointer.x * 0.5 + 0.5, 0, 1);
      return MathUtils.lerp(spineSettings.minYawDeg, spineSettings.maxYawDeg, normX);
    })();

    this.euler.set(0, MathUtils.degToRad(targetYawDeg), 0, "YXZ");
    this.tmpQuatA.setFromEuler(this.euler); // delta
    this.tmpQuatB.copy(this.spineInitRot).premultiply(this.tmpQuatA); // delta * init

    const alpha = slerpFactor(spineSettings.smoothness, delta);
    this.spineDriverRot.slerp(this.tmpQuatB, alpha);

    // delta = driver * inverse(init)
    this.tmpQuatA.copy(this.spineInitRot).invert();
    this.tmpQuatC.copy(this.spineDriverRot).multiply(this.tmpQuatA);

    const applied = this.spineTrackingWeight * clamp01(spineSettings.blend);
    const falloff = clamp01(spineSettings.falloff);

    const apply = (node: Object3D | null, boneName: VRMHumanBoneName, weight: number) => {
      if (!node) return;
      const base = this.getBaseRotation(node, boneName);
      // offset = slerp(identity, delta, applied * weight)
      this.tmpQuatB.identity().slerp(this.tmpQuatC, clamp01(applied * weight));
      this.tmpQuatA.copy(base).premultiply(this.tmpQuatB);
      node.quaternion.copy(this.tmpQuatA);
    };

    apply(spine, VRMHumanBoneName.Spine, 1);
    apply(this.chestBone, VRMHumanBoneName.Chest, falloff);
    apply(this.upperChestBone, VRMHumanBoneName.UpperChest, falloff * falloff);
  }

  private handleEyeTracking(options: {
    delta: number;
    pointer: Vec2;
    camera: PerspectiveCamera | null;
    settings: VrmMouseTrackingSettings;
    weight: number;
  }) {
    const { delta, pointer, camera, settings, weight } = options;
    const leftEye = this.leftEyeBone;
    const rightEye = this.rightEyeBone;
    const eyeSettings = settings.eyes;

    if (!leftEye || !rightEye) {
      return;
    }

    const enabled = settings.enabled && eyeSettings.enabled;
    const applied = enabled ? clamp01(eyeSettings.blend) * clamp01(weight) : 0;

    const baseYawPitch = enabled
      ? camera
        ? this.computeYawPitchFromCameraPointer({
            pointer,
            camera,
            yawLimitDeg: eyeSettings.yawLimitDeg,
            pitchLimitDeg: eyeSettings.pitchLimitDeg,
          })
        : this.computeYawPitchDegrees(pointer, eyeSettings.yawLimitDeg, eyeSettings.pitchLimitDeg)
      : { yaw: 0, pitch: 0 };
    this.ensureEyeSigns(camera);
    const yaw = baseYawPitch.yaw;
    const pitch = baseYawPitch.pitch;
    const yawRad = MathUtils.degToRad(this.eyesYawSign * yaw);
    const pitchRad = MathUtils.degToRad(this.eyesPitchSign * pitch);

    this.euler.set(pitchRad, yawRad, 0, "YXZ");
    this.tmpQuatA.setFromEuler(this.euler); // delta

    const alpha = slerpFactor(eyeSettings.smoothness, delta);

    // Left eye
    this.tmpQuatB.copy(this.leftEyeInitRot).premultiply(this.tmpQuatA);
    this.leftEyeDriverRot.slerp(this.tmpQuatB, alpha);
    this.tmpQuatB.copy(this.leftEyeInitRot).invert();
    this.tmpQuatC.copy(this.leftEyeDriverRot).multiply(this.tmpQuatB); // deltaApplied
    const leftBase = this.getBaseRotation(leftEye, VRMHumanBoneName.LeftEye);
    this.tmpQuatB.copy(leftBase).premultiply(this.tmpQuatC);
    leftEye.quaternion.copy(leftBase).slerp(this.tmpQuatB, applied);

    // Right eye
    this.tmpQuatB.copy(this.rightEyeInitRot).premultiply(this.tmpQuatA);
    this.rightEyeDriverRot.slerp(this.tmpQuatB, alpha);
    this.tmpQuatB.copy(this.rightEyeInitRot).invert();
    this.tmpQuatC.copy(this.rightEyeDriverRot).multiply(this.tmpQuatB);
    const rightBase = this.getBaseRotation(rightEye, VRMHumanBoneName.RightEye);
    this.tmpQuatB.copy(rightBase).premultiply(this.tmpQuatC);
    rightEye.quaternion.copy(rightBase).slerp(this.tmpQuatB, applied);
  }

  update(options: {
    delta: number;
    time: number;
    pointer: Vec2 | null;
    camera: PerspectiveCamera | null;
    settings: VrmMouseTrackingSettings;
    headWeight?: number;
    spineWeight?: number;
    eyesWeight?: number;
    allowRestPoseOverride?: boolean;
  }) {
    const {
      delta,
      time,
      pointer,
      camera,
      settings,
      headWeight = 1,
      spineWeight = 1,
      eyesWeight = 1,
      allowRestPoseOverride = true,
    } = options;

    if (!this.vrm.humanoid) return;
    this.allowRestPoseOverride = allowRestPoseOverride;

    const wantsEyeTracking = Boolean(
      settings.enabled &&
        settings.eyes.enabled &&
        clamp01(eyesWeight) > 0.001 &&
        this.leftEyeBone &&
        this.rightEyeBone
    );
    // If a model has an active VRMLookAt target, disable it while we drive eye bones directly.
    if (this.vrm.lookAt) {
      if (wantsEyeTracking && this.vrm.lookAt.target) {
        this.lookAtTargetBackup = this.vrm.lookAt.target;
        this.vrm.lookAt.target = null;
      } else if (!wantsEyeTracking && this.lookAtTargetBackup) {
        if (!this.vrm.lookAt.target) {
          this.vrm.lookAt.target = this.lookAtTargetBackup;
        }
        this.lookAtTargetBackup = null;
      }
    }

    const drift: Vec2 = {
      x: Math.sin(time * 0.7) * 0.15,
      y: Math.sin(time * 0.9) * 0.08,
    };
    const effectivePointer = pointer ?? drift;

    this.handleEyeTracking({
      delta,
      pointer: effectivePointer,
      camera,
      settings,
      weight: eyesWeight,
    });
    this.handleHeadTracking({
      delta,
      time,
      pointer: effectivePointer,
      camera,
      settings,
      weight: headWeight,
    });
    this.handleSpineTracking({
      delta,
      pointer,
      weight: spineWeight,
      settings,
      allowed: true,
    });
  }
}
