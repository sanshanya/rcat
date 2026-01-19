import { useCallback, useEffect, useRef } from "react";
import type { AnimationClip, PerspectiveCamera } from "three";
import type { VRM } from "@pixiv/three-vrm";
import { EVT_GLOBAL_CURSOR_GAZE } from "@/constants";
import { EVT_VOICE_SPEECH_END, EVT_VOICE_SPEECH_START } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { ExpressionMixer } from "@/components/vrm/ExpressionMixer";
import { normalizeArmsForIdle } from "@/components/vrm/armNormalization";
import { AvatarMouseTracking } from "@/components/vrm/AvatarMouseTracking";
import {
  DEFAULT_IDLE_MOTION_URL,
  captureRestPose,
  type RestPoseMap,
} from "@/components/vrm/idleMotion";
import { useLipSync } from "@/components/vrm/useLipSync";
import { getVrmToolMode, type VrmToolMode } from "@/components/vrm/vrmToolModeStore";
import { getExpressionOverrides } from "@/components/vrm/expressionOverrideStore";
import {
  getCachedExpressionBindings,
  getExpressionBindingsSnapshot,
  loadExpressionBindings,
  subscribeExpressionBindings,
} from "@/components/vrm/expressionBindingsStore";
import {
  getCachedEmotionProfile,
  loadEmotionProfile,
} from "@/components/vrm/emotionProfileStore";
import { buildEmotionExpressions } from "@/components/vrm/emotionRecipes";
import { getEmotionState, subscribeEmotionState } from "@/components/vrm/emotionStore";
import type { EmotionId } from "@/components/vrm/emotionTypes";
import { AvatarInteractionEngine } from "@/components/vrm/avatarInteractionEngine";
import { AvatarGazeController } from "@/components/vrm/avatarGazeController";
import { BlinkController } from "@/components/vrm/blinkController";
import { SpeechGestureController } from "@/components/vrm/speechGestures";
import { setAvatarInteractionRuntime } from "@/components/vrm/avatarInteractionStore";
import { pushAvatarBehaviorEvent } from "@/components/vrm/avatarBehaviorEventRuntime";
import { EmotionMotionCoordinator } from "@/components/vrm/emotionMotionCoordinator";
import { IdleMotionController } from "@/components/vrm/IdleMotionController";
import { MotionController } from "@/components/vrm/motion/MotionController";

type VrmBehaviorOptions = {
  idleMotionUrl?: string | null;
};

export const useVrmBehavior = ({
  idleMotionUrl = DEFAULT_IDLE_MOTION_URL,
}: VrmBehaviorOptions = {}) => {
  const { onFrame: lipSyncOnFrame, reset: lipSyncReset } = useLipSync();
  const vrmRef = useRef<VRM | null>(null);
  const vrmUrlRef = useRef<string | null>(null);
  const restPoseRef = useRef<RestPoseMap | null>(null);
  const mouseTrackingRef = useRef<AvatarMouseTracking | null>(null);
  const gazeControllerRef = useRef<AvatarGazeController>(new AvatarGazeController());
  const blinkControllerRef = useRef<BlinkController>(new BlinkController());
  const timeRef = useRef(0);
  const voiceSpeakingRef = useRef(false);
  const expressionDriverRef = useRef<ReturnType<typeof createExpressionDriver> | null>(null);
  const expressionMixerRef = useRef<ExpressionMixer | null>(null);
  const interactionEngineRef = useRef<AvatarInteractionEngine | null>(null);
  const speechGesturesRef = useRef<SpeechGestureController | null>(null);
  const motionControllerRef = useRef<MotionController | null>(null);
  const idleMotionRef = useRef<IdleMotionController>(new IdleMotionController());
  const emotionRef = useRef<EmotionId>(getEmotionState().emotion);
  const emotionIntensityRef = useRef<number>(getEmotionState().intensity);
  const emotionMotionRef = useRef<EmotionMotionCoordinator>(new EmotionMotionCoordinator());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMouseMove = (event: MouseEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      gazeControllerRef.current.setLocalPointerFromClient(event.clientX, event.clientY, w, h);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useTauriEvent<{ x: number; y: number }>(EVT_GLOBAL_CURSOR_GAZE, (event) => {
    const { x, y } = event.payload;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    gazeControllerRef.current.setGlobalPointer({ x, y });
  });

  useTauriEvent<{ turnId: number }>(EVT_VOICE_SPEECH_START, (event) => {
    voiceSpeakingRef.current = true;
    pushAvatarBehaviorEvent({
      type: "speechStart",
      turnId: Number(event.payload.turnId) || 0,
      timeMs: performance.now(),
    });
  });
  useTauriEvent<{ turnId: number }>(EVT_VOICE_SPEECH_END, (event) => {
    voiceSpeakingRef.current = false;
    pushAvatarBehaviorEvent({
      type: "speechEnd",
      turnId: Number(event.payload.turnId) || 0,
      timeMs: performance.now(),
    });
  });

  useEffect(() => {
    const unsubscribe = subscribeExpressionBindings(() => {
      const vrm = vrmRef.current;
      const url = vrmUrlRef.current;
      if (!vrm || !url) return;
      const snapshot = getExpressionBindingsSnapshot();
      if (snapshot.url !== url) return;
      expressionDriverRef.current = createExpressionDriver(vrm.expressionManager ?? null, {
        bindings: snapshot.bindings,
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeEmotionState(() => {
      const snapshot = getEmotionState();
      emotionRef.current = snapshot.emotion;
      emotionIntensityRef.current = snapshot.intensity;
    });
    return unsubscribe;
  }, []);

  const setVrm = useCallback((vrm: VRM | null, url: string | null = null) => {
    idleMotionRef.current.stop(mouseTrackingRef.current);
    vrmRef.current = vrm;
    vrmUrlRef.current = url?.trim() ? url.trim() : null;
    mouseTrackingRef.current = null;
    expressionDriverRef.current = null;
    expressionMixerRef.current = null;
    interactionEngineRef.current = null;
    speechGesturesRef.current = null;
    motionControllerRef.current?.dispose();
    motionControllerRef.current = null;
    restPoseRef.current = null;
    emotionMotionRef.current.reset();
    setAvatarInteractionRuntime({ zone: null, distance: null, updatedAt: null });
    gazeControllerRef.current.reset();

    if (!vrm) {
      lipSyncReset();
      return;
    }

    normalizeArmsForIdle(vrm);
    restPoseRef.current = captureRestPose(vrm);

    const bindings = getCachedExpressionBindings(vrmUrlRef.current);
    expressionDriverRef.current = createExpressionDriver(vrm.expressionManager ?? null, {
      bindings,
    });
    expressionMixerRef.current = new ExpressionMixer();
    mouseTrackingRef.current = new AvatarMouseTracking(vrm, restPoseRef.current);
    try {
      interactionEngineRef.current = new AvatarInteractionEngine(vrm);
    } catch (err) {
      console.warn("Avatar interaction zones disabled:", err);
      interactionEngineRef.current = null;
    }
    speechGesturesRef.current = new SpeechGestureController(vrm);
    blinkControllerRef.current.reset(performance.now());

    timeRef.current = 0;
    lipSyncReset();

    motionControllerRef.current = new MotionController(vrm, {
      onStopped: () => {
        emotionMotionRef.current.onControllerStopped();
        if (vrmRef.current === vrm) {
          idleMotionRef.current.start({
            vrm,
            url: idleMotionUrl,
            restPose: restPoseRef.current,
            tracker: mouseTrackingRef.current,
          });
        }
      },
    });
    const embedded = (vrm.scene.userData as Record<string, unknown>).__rcatEmbeddedAnimations;
    motionControllerRef.current.setEmbeddedClips(
      Array.isArray(embedded) ? (embedded as unknown as AnimationClip[]) : null
    );

    void loadExpressionBindings(vrmUrlRef.current);
    void loadEmotionProfile(vrmUrlRef.current);
    idleMotionRef.current.start({
      vrm,
      url: idleMotionUrl,
      restPose: restPoseRef.current,
      tracker: mouseTrackingRef.current,
    });
  }, [idleMotionUrl, lipSyncReset]);

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
      idleMotionRef.current.stop(mouseTrackingRef.current);
      const ok = await controller.playById(id, options);
      if (!ok) {
        idleMotionRef.current.start({
          vrm,
          url: idleMotionUrl,
          restPose: restPoseRef.current,
          tracker: mouseTrackingRef.current,
        });
      }
      return ok;
    },
    [idleMotionUrl]
  );

  const stopMotion = useCallback(() => {
    motionControllerRef.current?.stop();
  }, []);

  const afterVrmUpdate = useCallback((delta: number) => {
    motionControllerRef.current?.postUpdate(delta);
  }, []);

  const onFrame = useCallback((delta: number, camera: PerspectiveCamera | null) => {
    if (!vrmRef.current) return;
    idleMotionRef.current.update(delta);
    motionControllerRef.current?.update(delta);
    timeRef.current += delta;
    const now = performance.now();
    const mixer = expressionMixerRef.current;
    if (mixer) {
      mixer.clearChannel("blink");
      mixer.clearChannel("mouth");
      mixer.clearChannel("hover");
      mixer.clearChannel("click");
      mixer.clearChannel("speech");
    }
    const driver = expressionDriverRef.current;
    if (mixer && driver) {
      mixer.setChannel(
        "base",
        buildEmotionExpressions({
          emotion: emotionRef.current,
          driver,
          intensity: emotionIntensityRef.current,
        })
      );
    }

    {
      const controller = motionControllerRef.current;
      const url = vrmUrlRef.current;
      const emotion = emotionRef.current;
      if (controller && url) {
        const profile = getCachedEmotionProfile(url);
        const mapping = profile[emotion];
        emotionMotionRef.current.update({
          controller,
          emotion,
          desiredMotionId: mapping?.motionId ?? null,
          desiredLoopMotion: mapping?.loopMotion ?? true,
          playMotion,
        });
      } else {
        emotionMotionRef.current.update({
          controller: null,
          emotion,
          desiredMotionId: null,
          desiredLoopMotion: false,
          playMotion,
        });
      }
    }

    const toolMode: VrmToolMode = getVrmToolMode();
    const motionActive = motionControllerRef.current?.isPlaying() ?? false;
    blinkControllerRef.current.update({
      nowMs: now,
      enabled: !motionActive,
      mixer,
      driver,
    });

    const { pointer } = gazeControllerRef.current.update({
      delta,
      time: timeRef.current,
      nowMs: now,
      toolMode,
      motionActive,
      speaking: voiceSpeakingRef.current,
      camera,
      tracker: mouseTrackingRef.current,
    });

    let mouthValue: number | null = null;
    if (mixer && driver?.supports("aa")) {
      mouthValue = lipSyncOnFrame(delta);
      if (mouthValue !== null) {
        const emotion = emotionRef.current;
        const intensity = emotionIntensityRef.current;
        const base = emotion === "neutral" ? 0.6 : 0.35;
        const intensityFactor =
          Number.isFinite(intensity) && intensity > 1 ? intensity : 1;
        mixer.setValue("mouth", "aa", mouthValue * (base / intensityFactor));
      }
    }

    const vrm = vrmRef.current;
    const speechGestures = speechGesturesRef.current;
    if (vrm && speechGestures) {
      const applied = speechGestures.update({
        delta,
        speaking: voiceSpeakingRef.current,
        mouth: mouthValue ?? 0,
        toolMode,
        motionActive,
      });
      if (applied) {
        vrm.scene.updateMatrixWorld(true);
      }
    }

    if (mixer && camera) {
      const engine = interactionEngineRef.current;
      if (engine) {
        engine.update({
          delta,
          nowMs: now,
          pointer,
          camera,
          mixer,
          motionController: motionControllerRef.current,
          applySpringWind: toolMode === "avatar",
        });
      }
    }

    if (mixer && driver) {
      const overrides = getExpressionOverrides();
      if (overrides.enabled) {
        mixer.setManual(overrides.values);
      } else {
        mixer.clearManual();
      }
      mixer.apply(driver);
    }
  }, [lipSyncOnFrame, playMotion]);

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
