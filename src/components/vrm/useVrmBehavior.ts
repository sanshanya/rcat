import { useCallback, useRef } from "react";
import {
  AnimationClip,
  AnimationMixer,
  Euler,
  LoopRepeat,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VRMHumanBoneName } from "@pixiv/three-vrm";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { useLipSync } from "@/components/vrm/useLipSync";
import { loadVrmAnimation } from "@/components/vrm/motion/vrma/loadVrmAnimation";
import { loadMixamoAnimation } from "@/components/vrm/motion/mixamo/loadMixamoAnimation";

type BlinkState = {
  nextBlinkAt: number;
  phase: "idle" | "closing" | "opening";
  phaseStart: number;
};

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

const DEFAULT_IDLE_MOTION_URL = "/vrm/idle.motion.json";
const DEFAULT_IDLE_MOTION: IdleMotionSpec = {
  duration: 4,
  samples: 9,
  bones: [
    { name: "hips", sway: [0.01, 0.03, 0.008], phase: [0, 1.2, 3.14] },
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

const loadIdleMotionSpec = (url: string) => {
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

type RestPoseMap = Map<VRMHumanBoneName, Quaternion>;

const captureRestPose = (vrm: VRM): RestPoseMap => {
  const restPose: RestPoseMap = new Map();
  if (!vrm.humanoid) return restPose;
  (Object.values(VRMHumanBoneName) as VRMHumanBoneName[]).forEach((boneName) => {
    const node = vrm.humanoid?.getNormalizedBoneNode(boneName) ?? null;
    if (!node) return;
    restPose.set(boneName, node.quaternion.clone());
  });
  return restPose;
};

const relaxUpperArm = (options: {
  upperArm: Object3D;
  lowerArm: Object3D;
  outward: Vector3;
}) => {
  const { upperArm, lowerArm, outward } = options;
  upperArm.updateWorldMatrix(true, false);
  lowerArm.updateWorldMatrix(true, false);

  const upperPos = new Vector3().setFromMatrixPosition(upperArm.matrixWorld);
  const lowerPos = new Vector3().setFromMatrixPosition(lowerArm.matrixWorld);
  const currentDir = lowerPos.sub(upperPos).normalize();
  if (currentDir.lengthSq() < 1e-6) return;

  const down = new Vector3(0, -1, 0);
  const forward = new Vector3(0, 0, 1);
  const targetDir = down
    .multiplyScalar(0.89)
    .add(outward.clone().multiplyScalar(0.45))
    .add(forward.multiplyScalar(0.08))
    .normalize();
  if (targetDir.lengthSq() < 1e-6) return;

  const deltaWorld = new Quaternion().setFromUnitVectors(currentDir, targetDir);
  const upperWorld = new Quaternion();
  upperArm.getWorldQuaternion(upperWorld);
  const newUpperWorld = deltaWorld.multiply(upperWorld);

  const parentWorld = new Quaternion();
  upperArm.parent?.getWorldQuaternion(parentWorld);
  parentWorld.invert();
  const newLocal = parentWorld.multiply(newUpperWorld);

  upperArm.quaternion.copy(newLocal);
  upperArm.updateMatrixWorld(true);
};

const relaxLowerArm = (options: {
  lowerArm: Object3D;
  hand: Object3D;
  outward: Vector3;
}) => {
  const { lowerArm, hand, outward } = options;
  lowerArm.updateWorldMatrix(true, false);
  hand.updateWorldMatrix(true, false);

  const lowerPos = new Vector3().setFromMatrixPosition(lowerArm.matrixWorld);
  const handPos = new Vector3().setFromMatrixPosition(hand.matrixWorld);
  const currentDir = handPos.sub(lowerPos).normalize();
  if (currentDir.lengthSq() < 1e-6) return;

  const down = new Vector3(0, -1, 0);
  const forward = new Vector3(0, 0, 1);
  const targetDir = down
    .multiplyScalar(0.94)
    .add(outward.clone().multiplyScalar(0.22))
    .add(forward.multiplyScalar(0.14))
    .normalize();
  if (targetDir.lengthSq() < 1e-6) return;

  const deltaWorld = new Quaternion().setFromUnitVectors(currentDir, targetDir);
  const lowerWorld = new Quaternion();
  lowerArm.getWorldQuaternion(lowerWorld);
  const newLowerWorld = deltaWorld.multiply(lowerWorld);

  const parentWorld = new Quaternion();
  lowerArm.parent?.getWorldQuaternion(parentWorld);
  parentWorld.invert();
  const newLocal = parentWorld.multiply(newLowerWorld);

  lowerArm.quaternion.copy(newLocal);
  lowerArm.updateMatrixWorld(true);
};

const relaxArmsIntoStandPose = (vrm: VRM) => {
  if (!vrm.humanoid) return;
  const leftUpper = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
  const leftLower = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
  if (leftUpper && leftLower) {
    relaxUpperArm({
      upperArm: leftUpper,
      lowerArm: leftLower,
      outward: new Vector3(-1, 0, 0),
    });
  }
  const leftHand = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftHand);
  if (leftLower && leftHand) {
    relaxLowerArm({
      lowerArm: leftLower,
      hand: leftHand,
      outward: new Vector3(-1, 0, 0),
    });
  }

  const rightUpper = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
  const rightLower = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);
  if (rightUpper && rightLower) {
    relaxUpperArm({
      upperArm: rightUpper,
      lowerArm: rightLower,
      outward: new Vector3(1, 0, 0),
    });
  }
  const rightHand = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightHand);
  if (rightLower && rightHand) {
    relaxLowerArm({
      lowerArm: rightLower,
      hand: rightHand,
      outward: new Vector3(1, 0, 0),
    });
  }
};

const buildIdleClip = (
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

const BLINK_MIN_MS = 2000;
const BLINK_MAX_MS = 5000;
const BLINK_CLOSE_MS = 70;
const BLINK_OPEN_MS = 150;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

const randomRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

type VrmBehaviorOptions = {
  idleMotionUrl?: string | null;
};

export const useVrmBehavior = ({
  idleMotionUrl = DEFAULT_IDLE_MOTION_URL,
}: VrmBehaviorOptions = {}) => {
  const { onFrame: lipSyncOnFrame, reset: lipSyncReset } = useLipSync();
  const vrmRef = useRef<VRM | null>(null);
  const restPoseRef = useRef<RestPoseMap | null>(null);
  const lookAtTargetRef = useRef<Object3D | null>(null);
  const timeRef = useRef(0);
  const headRef = useRef<Object3D | null>(null);
  const headBaseRef = useRef<Vector3 | null>(null);
  const expressionDriverRef = useRef<ReturnType<typeof createExpressionDriver> | null>(null);
  const idleMixerRef = useRef<AnimationMixer | null>(null);
  const idleRootRef = useRef<Object3D | null>(null);
  const idleActionRef = useRef<ReturnType<AnimationMixer["clipAction"]> | null>(null);
  const idleSeqRef = useRef(0);
  const blinkRef = useRef<BlinkState>({
    nextBlinkAt: 0,
    phase: "idle",
    phaseStart: 0,
  });

  const stopIdleMotion = useCallback(() => {
    idleSeqRef.current += 1;
    const mixer = idleMixerRef.current;
    const root = idleRootRef.current;
    if (mixer && root) {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }
    idleMixerRef.current = null;
    idleRootRef.current = null;
    idleActionRef.current = null;
  }, []);

  const startIdleMotion = useCallback(
    (vrm: VRM) => {
      const url = idleMotionUrl?.trim();
      if (!url) return;
      const seq = (idleSeqRef.current += 1);
      const restPose = restPoseRef.current ?? captureRestPose(vrm);
      restPoseRef.current = restPose;

      const mixer = new AnimationMixer(vrm.scene);
      idleMixerRef.current = mixer;
      idleRootRef.current = vrm.scene;

      const fallbackClip = buildIdleClip(vrm, DEFAULT_IDLE_MOTION, restPose);
      if (fallbackClip) {
        const action = mixer.clipAction(fallbackClip);
        action.setLoop(LoopRepeat, Infinity);
        action.play();
        idleActionRef.current = action;
      }

      void (async () => {
        const lowerUrl = url.toLowerCase();
        const loadedClip = await (async () => {
          if (
            lowerUrl.endsWith(".vrma") ||
            lowerUrl.endsWith(".glb") ||
            lowerUrl.endsWith(".gltf")
          ) {
            try {
              return await loadVrmAnimation(url, vrm);
            } catch {
              return null;
            }
          }

          if (lowerUrl.endsWith(".fbx")) {
            try {
              return await loadMixamoAnimation(url, vrm);
            } catch {
              return null;
            }
          }

          const loaded = await loadIdleMotionSpec(url);
          if (!loaded) return null;
          return buildIdleClip(vrm, loaded, restPose);
        })();
        if (!loadedClip) return;
        if (seq !== idleSeqRef.current || vrmRef.current !== vrm) return;
        const activeMixer = idleMixerRef.current;
        if (!activeMixer) return;
        const nextAction = activeMixer.clipAction(loadedClip);
        nextAction.reset();
        nextAction.setLoop(LoopRepeat, Infinity);
        nextAction.fadeIn(0.25);
        nextAction.play();
        idleActionRef.current?.fadeOut(0.25);
        idleActionRef.current = nextAction;
      })();
    },
    [idleMotionUrl]
  );

  const setVrm = useCallback((vrm: VRM | null) => {
    if (vrmRef.current && lookAtTargetRef.current) {
      vrmRef.current.scene.remove(lookAtTargetRef.current);
    }
    stopIdleMotion();
    vrmRef.current = vrm;
    headRef.current = null;
    headBaseRef.current = null;
    lookAtTargetRef.current = null;
    expressionDriverRef.current = null;
    restPoseRef.current = null;

    if (!vrm) {
      lipSyncReset();
      return;
    }

    relaxArmsIntoStandPose(vrm);
    restPoseRef.current = captureRestPose(vrm);

    expressionDriverRef.current = createExpressionDriver(vrm.expressionManager ?? null);

    const target = new Object3D();
    target.position.set(0, 1.35, 2.0);
    vrm.scene.add(target);
    lookAtTargetRef.current = target;

    if (vrm.lookAt) {
      vrm.lookAt.target = target;
    }

    const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head) ?? null;
    headRef.current = head;
    if (head) {
      headBaseRef.current = new Vector3(
        head.rotation.x,
        head.rotation.y,
        head.rotation.z
      );
    }

    blinkRef.current = {
      nextBlinkAt: performance.now() + randomRange(BLINK_MIN_MS, BLINK_MAX_MS),
      phase: "idle",
      phaseStart: 0,
    };
    timeRef.current = 0;
    lipSyncReset();
    startIdleMotion(vrm);
  }, [lipSyncReset, startIdleMotion, stopIdleMotion]);

  const updateBlink = useCallback((now: number) => {
    const driver = expressionDriverRef.current;
    if (!driver || !driver.supports("blink")) return;

    const state = blinkRef.current;
    let weight = 0;

    if (state.phase === "idle") {
      if (now >= state.nextBlinkAt) {
        state.phase = "closing";
        state.phaseStart = now;
      } else {
        return;
      }
    }

    if (state.phase === "closing") {
      const t = (now - state.phaseStart) / BLINK_CLOSE_MS;
      if (t >= 1) {
        weight = 1;
        state.phase = "opening";
        state.phaseStart = now;
      } else {
        weight = easeOutCubic(Math.max(0, Math.min(1, t)));
      }
    }

    if (state.phase === "opening") {
      const t = (now - state.phaseStart) / BLINK_OPEN_MS;
      if (t >= 1) {
        weight = 0;
        state.phase = "idle";
        state.nextBlinkAt = now + randomRange(BLINK_MIN_MS, BLINK_MAX_MS);
      } else {
        weight = 1 - easeInCubic(Math.max(0, Math.min(1, t)));
      }
    }

    driver.setValue("blink", weight);
  }, []);

  const updateLookAt = useCallback((time: number) => {
    const target = lookAtTargetRef.current;
    if (!target) return;

    const driftX = Math.sin(time * 0.7) * 0.15;
    const driftY = Math.sin(time * 0.9) * 0.08;
    target.position.set(driftX, 1.35 + driftY, 2.0);
  }, []);

  const updateHeadIdle = useCallback((time: number) => {
    const head = headRef.current;
    const base = headBaseRef.current;
    if (!head || !base) return;

    const pitch = Math.sin(time * 1.15) * 0.03;
    const yaw = Math.sin(time * 0.8 + 1.2) * 0.04;
    const roll = Math.sin(time * 0.9 + 2.4) * 0.015;

    head.rotation.set(base.x + pitch, base.y + yaw, base.z + roll);
  }, []);

  const onFrame = useCallback((delta: number) => {
    if (!vrmRef.current) return;
    idleMixerRef.current?.update(delta);
    timeRef.current += delta;
    const now = performance.now();
    updateBlink(now);
    updateLookAt(timeRef.current);
    updateHeadIdle(timeRef.current);
    const driver = expressionDriverRef.current;
    if (driver?.supports("aa")) {
      const mouth = lipSyncOnFrame(delta);
      if (mouth !== null) {
        driver.setValue("aa", mouth);
      }
    }
  }, [lipSyncOnFrame, updateBlink, updateHeadIdle, updateLookAt]);

  return { setVrm, onFrame };
};
