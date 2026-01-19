import {
  AnimationClip,
  Euler,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

type IdleMotionBone = {
  name: string;
  base?: [number, number, number];
  sway?: [number, number, number];
  phase?: [number, number, number];
};

type IdleMotionSpec = {
  duration: number;
  samples?: number;
  bones: IdleMotionBone[];
};

export const DEFAULT_IDLE_MOTION_URL = "/vrm/idle.motion.json";

export const DEFAULT_IDLE_MOTION: IdleMotionSpec = {
  duration: 4,
  samples: 9,
  bones: [
    { name: "spine", sway: [0.02, 0.02, 0.01], phase: [1.57, 0.3, 2.8] },
    { name: "chest", sway: [0.03, 0.015, 0.012], phase: [0.7, 1.57, 3.2] },
    { name: "upperChest", sway: [0.02, 0.01, 0.008], phase: [1.2, 0.9, 2.1] },
    { name: "neck", sway: [0.015, 0.01, 0.01], phase: [1.8, 1.0, 2.6] },
    { name: "leftShoulder", sway: [0.01, 0.0, -0.015], phase: [0, 0, 0] },
    { name: "rightShoulder", sway: [0.01, 0.0, 0.015], phase: [0, 0, 0] },
    { name: "leftUpperArm", sway: [0.005, 0.0, -0.01], phase: [0.3, 0, 1.0] },
    { name: "rightUpperArm", sway: [0.005, 0.0, 0.01], phase: [0.3, 0, 1.0] },
    { name: "leftLowerArm", sway: [0.006, 0.0, -0.008], phase: [0.6, 0, 1.2] },
    { name: "rightLowerArm", sway: [0.006, 0.0, 0.008], phase: [0.6, 0, 1.2] },
    { name: "leftHand", sway: [0.01, 0.0, -0.01], phase: [1.1, 0, 2.3] },
    { name: "rightHand", sway: [0.01, 0.0, 0.01], phase: [1.1, 0, 2.3] },
  ],
};

const ZERO_VEC3: [number, number, number] = [0, 0, 0];
const idleMotionCache = new Map<string, Promise<IdleMotionSpec | null>>();

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const toVec3 = (value: unknown): [number, number, number] | null => {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (![x, y, z].every(isNumber)) return null;
  return [x, y, z];
};

const parseIdleMotionSpec = (value: unknown): IdleMotionSpec | null => {
  if (!value || typeof value !== "object") return null;
  const spec = value as {
    duration?: unknown;
    samples?: unknown;
    bones?: unknown;
  };
  if (!isNumber(spec.duration) || spec.duration <= 0) return null;
  if (!Array.isArray(spec.bones) || spec.bones.length === 0) return null;
  const bones = spec.bones
    .map((bone) => {
      if (!bone || typeof bone !== "object") return null;
      const raw = bone as {
        name?: unknown;
        base?: unknown;
        sway?: unknown;
        phase?: unknown;
      };
      if (typeof raw.name !== "string" || raw.name.length === 0) return null;
      const base = toVec3(raw.base);
      const sway = toVec3(raw.sway);
      const phase = toVec3(raw.phase);
      const motionBone: IdleMotionBone = { name: raw.name };
      if (base) motionBone.base = base;
      if (sway) motionBone.sway = sway;
      if (phase) motionBone.phase = phase;
      return motionBone;
    })
    .filter((bone): bone is IdleMotionBone => bone !== null);
  if (bones.length === 0) return null;
  const samples =
    isNumber(spec.samples) && spec.samples >= 2 ? Math.floor(spec.samples) : undefined;
  return { duration: spec.duration, samples, bones };
};

export const loadIdleMotionSpec = (url: string) => {
  const cached = idleMotionCache.get(url);
  if (cached) return cached;
  const task = fetch(url)
    .then((response) => (response.ok ? response.json() : null))
    .then(parseIdleMotionSpec)
    .catch(() => null);
  idleMotionCache.set(url, task);
  return task;
};

const isHumanBoneName = (value: string): value is VRMHumanBoneName =>
  (Object.values(VRMHumanBoneName) as string[]).includes(value);

export type RestPoseMap = Map<VRMHumanBoneName, Quaternion>;

export const captureRestPose = (vrm: VRM): RestPoseMap => {
  const restPose: RestPoseMap = new Map();
  if (!vrm.humanoid) return restPose;
  (Object.values(VRMHumanBoneName) as VRMHumanBoneName[]).forEach((boneName) => {
    const node = vrm.humanoid?.getNormalizedBoneNode(boneName) ?? null;
    if (!node) return;
    restPose.set(boneName, node.quaternion.clone());
  });
  return restPose;
};

export const buildIdleClip = (
  vrm: VRM,
  spec: IdleMotionSpec,
  restPose: RestPoseMap | null
): AnimationClip | null => {
  if (!vrm.humanoid) return null;
  const duration = spec.duration;
  const samples = Math.max(2, spec.samples ?? 5);
  const times = Array.from({ length: samples }, (_, index) =>
    (duration * index) / (samples - 1)
  );
  const tracks: QuaternionKeyframeTrack[] = [];
  const euler = new Euler();
  const deltaQuat = new Quaternion();
  const outputQuat = new Quaternion();

  spec.bones.forEach((boneSpec) => {
    if (!isHumanBoneName(boneSpec.name)) return;
    const node = vrm.humanoid?.getNormalizedBoneNode(boneSpec.name) ?? null;
    if (!node) return;
    const base = boneSpec.base ?? ZERO_VEC3;
    const sway = boneSpec.sway ?? ZERO_VEC3;
    const phase = boneSpec.phase ?? ZERO_VEC3;
    const restQuat = (restPose?.get(boneSpec.name) ?? node.quaternion).clone();
    const values: number[] = [];
    times.forEach((time) => {
      const t = (time / duration) * Math.PI * 2;
      euler.set(
        base[0] + Math.sin(t + phase[0]) * sway[0],
        base[1] + Math.sin(t + phase[1]) * sway[1],
        base[2] + Math.sin(t + phase[2]) * sway[2]
      );
      deltaQuat.setFromEuler(euler);
      outputQuat.copy(restQuat).multiply(deltaQuat);
      values.push(outputQuat.x, outputQuat.y, outputQuat.z, outputQuat.w);
    });
    if (values.length > 0) {
      tracks.push(new QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, values));
    }
  });

  if (tracks.length === 0) return null;
  return new AnimationClip("idle", duration, tracks);
};
