import { useCallback, useEffect, useRef } from "react";
import {
  AnimationMixer,
  LoopRepeat,
  Object3D,
  Vector3,
} from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VRMHumanBoneName } from "@pixiv/three-vrm";
import { EVT_GLOBAL_CURSOR_GAZE } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { normalizeArmsForIdle } from "@/components/vrm/armNormalization";
import {
  DEFAULT_IDLE_MOTION,
  DEFAULT_IDLE_MOTION_URL,
  buildIdleClip,
  captureRestPose,
  loadIdleMotionSpec,
  type RestPoseMap,
} from "@/components/vrm/idleMotion";
import { useLipSync } from "@/components/vrm/useLipSync";
import {
  getGazeRuntimeDebug,
  setGazeRuntimeDebug,
  type GazeSource,
} from "@/components/vrm/useGazeDebug";
import { MotionController } from "@/components/vrm/motion/MotionController";
import { loadVrmAnimation } from "@/components/vrm/motion/vrma/loadVrmAnimation";
import { loadMixamoAnimation } from "@/components/vrm/motion/mixamo/loadMixamoAnimation";

type BlinkState = {
  nextBlinkAt: number;
  phase: "idle" | "closing" | "opening";
  phaseStart: number;
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
  const lookAtLocalRef = useRef<{ x: number; y: number } | null>(null);
  const lookAtLocalAtMsRef = useRef(0);
  const lookAtGlobalRef = useRef<{ x: number; y: number } | null>(null);
  const lookAtGlobalAtMsRef = useRef(0);
  const lookAtSmoothedRef = useRef<{ x: number; y: number } | null>(null);
  const lookAtTimeRef = useRef(0);
  const timeRef = useRef(0);
  const headRef = useRef<Object3D | null>(null);
  const headBaseRef = useRef<Vector3 | null>(null);
  const headGazeRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const headGazeTimeRef = useRef(0);
  const gazeDebugAtRef = useRef(0);
  const gazeDebugRef = useRef<{ x: number; y: number; source: GazeSource }>({
    x: 0,
    y: 0,
    source: "drift",
  });
  const expressionDriverRef = useRef<ReturnType<typeof createExpressionDriver> | null>(null);
  const motionControllerRef = useRef<MotionController | null>(null);
  const idleMixerRef = useRef<AnimationMixer | null>(null);
  const idleRootRef = useRef<Object3D | null>(null);
  const idleActionRef = useRef<ReturnType<AnimationMixer["clipAction"]> | null>(null);
  const idleSeqRef = useRef(0);
  const blinkRef = useRef<BlinkState>({
    nextBlinkAt: 0,
    phase: "idle",
    phaseStart: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMouseMove = (event: MouseEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (!Number.isFinite(w) || w <= 0) return;
      if (!Number.isFinite(h) || h <= 0) return;

      lookAtLocalRef.current = {
        x: (event.clientX / w) * 2 - 1,
        y: 1 - (event.clientY / h) * 2,
      };
      lookAtLocalAtMsRef.current = performance.now();
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useTauriEvent<{ x: number; y: number }>(EVT_GLOBAL_CURSOR_GAZE, (event) => {
    const { x, y } = event.payload;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    lookAtGlobalRef.current = { x, y };
    lookAtGlobalAtMsRef.current = performance.now();
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
    headGazeRef.current = { x: 0, y: 0 };
    headGazeTimeRef.current = 0;
    lookAtTargetRef.current = null;
    lookAtLocalRef.current = null;
    lookAtLocalAtMsRef.current = 0;
    lookAtGlobalRef.current = null;
    lookAtGlobalAtMsRef.current = 0;
    lookAtSmoothedRef.current = null;
    lookAtTimeRef.current = 0;
    expressionDriverRef.current = null;
    motionControllerRef.current?.dispose();
    motionControllerRef.current = null;
    restPoseRef.current = null;
    gazeDebugAtRef.current = 0;
    gazeDebugRef.current = { x: 0, y: 0, source: "drift" };

    if (!vrm) {
      lipSyncReset();
      return;
    }

    normalizeArmsForIdle(vrm);
    restPoseRef.current = captureRestPose(vrm);

    expressionDriverRef.current = createExpressionDriver(vrm.expressionManager ?? null);

    const target = new Object3D();
    target.position.set(0, 1.35, 1.6);
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

    motionControllerRef.current = new MotionController(vrm, {
      onStopped: () => {
        if (vrmRef.current === vrm) {
          startIdleMotion(vrm);
        }
      },
    });
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

  const getMotionController = useCallback(() => motionControllerRef.current, []);

  const preloadMotion = useCallback(async (id: string) => {
    const controller = motionControllerRef.current;
    if (!controller) return null;
    return await controller.preloadById(id);
  }, []);

  const playMotion = useCallback(
    async (id: string, options?: { loop?: boolean; fadeIn?: number }) => {
      const controller = motionControllerRef.current;
      const vrm = vrmRef.current;
      if (!controller || !vrm) return false;
      const driver = expressionDriverRef.current;
      if (driver?.supports("blink")) {
        driver.setValue("blink", 0);
      }
      stopIdleMotion();
      const ok = await controller.playById(id, options);
      if (!ok) {
        startIdleMotion(vrm);
      }
      return ok;
    },
    [startIdleMotion, stopIdleMotion]
  );

  const stopMotion = useCallback(() => {
    motionControllerRef.current?.stop();
  }, []);

  const afterVrmUpdate = useCallback((delta: number) => {
    motionControllerRef.current?.postUpdate(delta);
  }, []);

  const pickGazePointer = useCallback(
    (nowMs: number) => {
      const debugState = getGazeRuntimeDebug();
      if (debugState.manualEnabled) {
        return {
          pointer: { x: debugState.manualX, y: debugState.manualY },
          source: "manual" as GazeSource,
        };
      }

      const localAge = nowMs - lookAtLocalAtMsRef.current;
      if (lookAtLocalRef.current && localAge < 200) {
        return { pointer: lookAtLocalRef.current, source: "local" as GazeSource };
      }

      const globalAge = nowMs - lookAtGlobalAtMsRef.current;
      if (lookAtGlobalRef.current && globalAge < 1500) {
        return { pointer: lookAtGlobalRef.current, source: "global" as GazeSource };
      }

      return { pointer: null, source: "drift" as GazeSource };
    },
    []
  );

  const updateLookAt = useCallback((time: number) => {
    const target = lookAtTargetRef.current;
    if (!target) return;

    const dt = Math.max(0, Math.min(0.1, time - lookAtTimeRef.current));
    lookAtTimeRef.current = time;

    const nowMs = performance.now();
    const { pointer, source } = pickGazePointer(nowMs);

    const driftX = Math.sin(time * 0.7) * 0.15;
    const driftY = Math.sin(time * 0.9) * 0.08;

    // Larger offsets for more noticeable gaze tracking.
    const desiredX = pointer ? pointer.x * 0.5 : driftX;
    const desiredY = pointer ? 1.35 + pointer.y * 0.25 : 1.35 + driftY;

    const smooth = lookAtSmoothedRef.current ?? { x: desiredX, y: desiredY };
    const k = pointer ? 18 : 6;
    const t = 1 - Math.exp(-k * dt);
    smooth.x += (desiredX - smooth.x) * t;
    smooth.y += (desiredY - smooth.y) * t;
    lookAtSmoothedRef.current = smooth;

    target.position.set(smooth.x, smooth.y, 1.6);

    const pointerX = pointer ? pointer.x : 0;
    const pointerY = pointer ? pointer.y : 0;
    const prev = gazeDebugRef.current;
    const changed =
      source !== prev.source ||
      Math.abs(pointerX - prev.x) > 0.01 ||
      Math.abs(pointerY - prev.y) > 0.01;
    if (changed || nowMs - gazeDebugAtRef.current > 200) {
      gazeDebugRef.current = { x: pointerX, y: pointerY, source };
      gazeDebugAtRef.current = nowMs;
      setGazeRuntimeDebug({ x: pointerX, y: pointerY, source, updatedAt: nowMs });
    }
  }, []);

  const updateHeadIdle = useCallback((time: number) => {
    const head = headRef.current;
    const base = headBaseRef.current;
    if (!head || !base) return;

    const dt = Math.max(0, Math.min(0.1, time - headGazeTimeRef.current));
    headGazeTimeRef.current = time;

    const { pointer } = pickGazePointer(performance.now());
    const targetX = pointer ? pointer.x : 0;
    const targetY = pointer ? pointer.y : 0;

    const gaze = headGazeRef.current;
    const k = pointer ? 10 : 6;
    const t = 1 - Math.exp(-k * dt);
    gaze.x += (targetX - gaze.x) * t;
    gaze.y += (targetY - gaze.y) * t;

    const pitch = Math.sin(time * 1.15) * 0.03;
    const yaw = Math.sin(time * 0.8 + 1.2) * 0.04;
    const roll = Math.sin(time * 0.9 + 2.4) * 0.015;

    const gazeYaw = gaze.x * 0.25;
    const gazePitch = -gaze.y * 0.14;
    const gazeRoll = -gaze.x * 0.05;

    head.rotation.set(
      base.x + pitch + gazePitch,
      base.y + yaw + gazeYaw,
      base.z + roll + gazeRoll
    );
  }, [pickGazePointer]);

  const onFrame = useCallback((delta: number) => {
    if (!vrmRef.current) return;
    idleMixerRef.current?.update(delta);
    motionControllerRef.current?.update(delta);
    timeRef.current += delta;
    const now = performance.now();
    const motionActive = motionControllerRef.current?.isPlaying() ?? false;
    if (!motionActive) {
      updateBlink(now);
      updateLookAt(timeRef.current);
      updateHeadIdle(timeRef.current);
    }
    const driver = expressionDriverRef.current;
    if (driver?.supports("aa")) {
      const mouth = lipSyncOnFrame(delta);
      if (mouth !== null) {
        driver.setValue("aa", mouth);
      }
    }
  }, [lipSyncOnFrame, updateBlink, updateHeadIdle, updateLookAt]);

  return {
    setVrm,
    onFrame,
    afterVrmUpdate,
    getMotionController,
    preloadMotion,
    playMotion,
    stopMotion,
  };
};
