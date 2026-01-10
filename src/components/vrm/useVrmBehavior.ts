import { useCallback, useEffect, useRef } from "react";
import {
  AnimationMixer,
  LoopRepeat,
  Object3D,
  type PerspectiveCamera,
} from "three";
import type { VRM } from "@pixiv/three-vrm";
import { EVT_GLOBAL_CURSOR_GAZE } from "@/constants";
import { EVT_VOICE_SPEECH_END, EVT_VOICE_SPEECH_START } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { normalizeArmsForIdle } from "@/components/vrm/armNormalization";
import { AvatarMouseTracking } from "@/components/vrm/AvatarMouseTracking";
import {
  DEFAULT_IDLE_MOTION,
  DEFAULT_IDLE_MOTION_URL,
  buildIdleClip,
  captureRestPose,
  loadIdleMotionSpec,
  type RestPoseMap,
} from "@/components/vrm/idleMotion";
import { useLipSync } from "@/components/vrm/useLipSync";
import { getMouseTrackingSettings } from "@/components/vrm/mouseTrackingStore";
import { getVrmToolMode } from "@/components/vrm/vrmToolModeStore";
import {
  computeTrackingPermissionsTarget,
  TrackingPermissionController,
} from "@/components/vrm/trackingPermissions";
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
  const mouseTrackingRef = useRef<AvatarMouseTracking | null>(null);
  const lookAtLocalRef = useRef<{ x: number; y: number } | null>(null);
  const lookAtGlobalRef = useRef<{ x: number; y: number } | null>(null);
  const timeRef = useRef(0);
  const gazeDebugAtRef = useRef(0);
  const gazeDebugRef = useRef<{ x: number; y: number; source: GazeSource }>({
    x: 0,
    y: 0,
    source: "drift",
  });
  const voiceSpeakingRef = useRef(false);
  const trackingPermissionsRef = useRef<TrackingPermissionController | null>(null);
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
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useTauriEvent<{ x: number; y: number }>(EVT_GLOBAL_CURSOR_GAZE, (event) => {
    const { x, y } = event.payload;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    lookAtGlobalRef.current = { x, y };
  });

  useTauriEvent<void>(EVT_VOICE_SPEECH_START, () => {
    voiceSpeakingRef.current = true;
  });
  useTauriEvent<void>(EVT_VOICE_SPEECH_END, () => {
    voiceSpeakingRef.current = false;
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
    mouseTrackingRef.current?.setAnimatedClip(null);
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
        mouseTrackingRef.current?.setAnimatedClip(fallbackClip);
      } else {
        mouseTrackingRef.current?.setAnimatedClip(null);
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
        mouseTrackingRef.current?.setAnimatedClip(loadedClip);
      })();
    },
    [idleMotionUrl]
  );

  const setVrm = useCallback((vrm: VRM | null) => {
    stopIdleMotion();
    vrmRef.current = vrm;
    mouseTrackingRef.current = null;
    lookAtLocalRef.current = null;
    lookAtGlobalRef.current = null;
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
    mouseTrackingRef.current = new AvatarMouseTracking(vrm, restPoseRef.current);
    trackingPermissionsRef.current = new TrackingPermissionController();

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

  const pickGazePointer = useCallback(() => {
      const debugState = getGazeRuntimeDebug();
      if (debugState.manualEnabled) {
        return {
          pointer: { x: debugState.manualX, y: debugState.manualY },
          source: "manual" as GazeSource,
        };
      }

      // Prefer global cursor tracking when available (desk-pet behavior).
      if (lookAtGlobalRef.current) {
        return { pointer: lookAtGlobalRef.current, source: "global" as GazeSource };
      }

      if (lookAtLocalRef.current) {
        return { pointer: lookAtLocalRef.current, source: "local" as GazeSource };
      }

      return { pointer: null, source: "drift" as GazeSource };
    },
    []
  );

  const updateMouseTracking = useCallback(
    (delta: number, time: number, camera: PerspectiveCamera | null) => {
      const tracker = mouseTrackingRef.current;
      if (!tracker) return;

      const nowMs = performance.now();
      const { pointer, source } = pickGazePointer();

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

      const motionActive = motionControllerRef.current?.isPlaying() ?? false;
      const toolMode = getVrmToolMode();
      const permissionsTarget = computeTrackingPermissionsTarget({
        motionActive,
        speaking: voiceSpeakingRef.current,
        toolMode,
      });
      const permissions =
        trackingPermissionsRef.current?.update(delta, permissionsTarget) ?? null;

      tracker.update({
        delta,
        time,
        pointer,
        camera,
        settings: getMouseTrackingSettings(),
        headWeight: permissions?.headWeight ?? 1,
        spineWeight: permissions?.spineWeight ?? 1,
        eyesWeight: permissions?.eyesWeight ?? 1,
        allowRestPoseOverride: !motionActive,
      });
    },
    [pickGazePointer]
  );

  const onFrame = useCallback((delta: number, camera: PerspectiveCamera | null) => {
    if (!vrmRef.current) return;
    idleMixerRef.current?.update(delta);
    motionControllerRef.current?.update(delta);
    timeRef.current += delta;
    const now = performance.now();
    const motionActive = motionControllerRef.current?.isPlaying() ?? false;
    if (!motionActive) {
      updateBlink(now);
    }
    updateMouseTracking(delta, timeRef.current, camera);
    const driver = expressionDriverRef.current;
    if (driver?.supports("aa")) {
      const mouth = lipSyncOnFrame(delta);
      if (mouth !== null) {
        driver.setValue("aa", mouth);
      }
    }
  }, [lipSyncOnFrame, updateBlink, updateMouseTracking]);

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
