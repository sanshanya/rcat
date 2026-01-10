import { Object3D, Quaternion, Vector3 } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

const getWorldPosition = (node: Object3D) =>
  new Vector3().setFromMatrixPosition(node.matrixWorld);

const getModelAxes = (vrm: VRM) => {
  const q = new Quaternion();
  vrm.scene.getWorldQuaternion(q);
  const up = new Vector3(0, 1, 0).applyQuaternion(q).normalize();
  const right = new Vector3(1, 0, 0).applyQuaternion(q).normalize();
  const forward = new Vector3(0, 0, 1).applyQuaternion(q).normalize();
  return { up, right, forward };
};

const rotateBoneTowards = (options: {
  bone: Object3D;
  from: Vector3;
  to: Vector3;
  targetDir: Vector3;
}) => {
  const { bone, from, to, targetDir } = options;
  const currentDir = to.clone().sub(from).normalize();
  if (currentDir.lengthSq() < 1e-8) return;
  if (targetDir.lengthSq() < 1e-8) return;

  const deltaWorld = new Quaternion().setFromUnitVectors(currentDir, targetDir);
  const boneWorld = new Quaternion();
  bone.getWorldQuaternion(boneWorld);
  const newWorld = deltaWorld.multiply(boneWorld);

  const parentWorld = new Quaternion();
  bone.parent?.getWorldQuaternion(parentWorld);
  parentWorld.invert();
  const newLocal = parentWorld.multiply(newWorld);

  bone.quaternion.copy(newLocal);
  bone.updateMatrixWorld(true);
};

/**
 * Normalize arm pose into a "stand" posture when the model ships with hands behind the back
 * or with arms too close to a strict T-pose.
 *
 * This runs once on VRM load and becomes the new rest pose for our procedural idle motion.
 */
export const normalizeArmsForIdle = (vrm: VRM) => {
  if (!vrm.humanoid) return;

  const { up, right, forward } = getModelAxes(vrm);
  const down = up.clone().negate();

  const applyArm = (options: {
    upper: Object3D | null;
    lower: Object3D | null;
    hand: Object3D | null;
    outwardSign: number;
  }) => {
    const { upper, lower, hand, outwardSign } = options;
    if (!upper || !lower || !hand) return;

    upper.updateWorldMatrix(true, false);
    lower.updateWorldMatrix(true, false);
    hand.updateWorldMatrix(true, false);

    const shoulderWorld = getWorldPosition(upper);
    const elbowWorld = getWorldPosition(lower);
    const handWorld = getWorldPosition(hand);

    const shoulderLocal = vrm.scene.worldToLocal(shoulderWorld.clone());
    const handLocal = vrm.scene.worldToLocal(handWorld.clone());
    const handDeltaLocal = handLocal.sub(shoulderLocal);

    const isBehindBack = handDeltaLocal.z < -0.02;
    const isNotDownEnough = handDeltaLocal.y > -0.12;
    if (!isBehindBack && !isNotDownEnough) return;

    const behindness = clamp01((-handDeltaLocal.z) / 0.25);
    const outward = right.clone().multiplyScalar(outwardSign);

    // Push forward harder when the hand starts behind the torso.
    const upperForward = lerp(0.12, 0.55, behindness);
    const lowerForward = lerp(0.18, 0.65, behindness);

    const upperTargetDir = down
      .clone()
      .multiplyScalar(1.0)
      .add(outward.clone().multiplyScalar(0.35))
      .add(forward.clone().multiplyScalar(upperForward))
      .normalize();

    rotateBoneTowards({
      bone: upper,
      from: shoulderWorld,
      to: elbowWorld,
      targetDir: upperTargetDir,
    });

    // Re-sample positions after upper arm change.
    lower.updateWorldMatrix(true, false);
    hand.updateWorldMatrix(true, false);
    const elbowWorld2 = getWorldPosition(lower);
    const handWorld2 = getWorldPosition(hand);

    const lowerTargetDir = down
      .clone()
      .multiplyScalar(1.0)
      .add(outward.clone().multiplyScalar(0.22))
      .add(forward.clone().multiplyScalar(lowerForward))
      .normalize();

    rotateBoneTowards({
      bone: lower,
      from: elbowWorld2,
      to: handWorld2,
      targetDir: lowerTargetDir,
    });
  };

  applyArm({
    upper: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm),
    lower: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm),
    hand: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftHand),
    outwardSign: -1,
  });

  applyArm({
    upper: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm),
    lower: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm),
    hand: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightHand),
    outwardSign: 1,
  });
};

