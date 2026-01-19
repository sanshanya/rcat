import { Clock } from "three";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VRM } from "@pixiv/three-vrm";

import type { VrmRendererFrameContext } from "@/components/vrm/vrmRendererTypes";
import type { RenderFps, RenderFpsMode } from "@/components/vrm/renderFpsStore";
import { setRenderFpsStats } from "@/components/vrm/renderFpsStore";

type FrameCallback = (vrm: VRM, delta: number, ctx: VrmRendererFrameContext) => void;

export type VrmRenderLoop = {
  start: () => void;
  stop: () => void;
};

const MAX_DELTA_SECONDS = 1 / 30;
const FPS_EPSILON_MS = 0.5;

export const createVrmRenderLoop = (options: {
  clock: Clock;
  camera: PerspectiveCamera;
  scene: Scene;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  frameContext: VrmRendererFrameContext;
  getVrm: () => VRM | null;
  getFpsMode: () => RenderFpsMode;
  getOnFrame: () => FrameCallback | undefined;
  getOnAfterFrame: () => FrameCallback | undefined;
  isContextLost: () => boolean;
}): VrmRenderLoop => {
  const {
    clock,
    camera,
    scene,
    renderer,
    controls,
    frameContext,
    getVrm,
    getFpsMode,
    getOnFrame,
    getOnAfterFrame,
    isContextLost,
  } = options;

  let frameId: number | null = null;

  const stop = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  const start = () => {
    if (frameId !== null) return;
    let lastRafAtMs = performance.now();
    let accumulatedMs = 0;
    let rafEmaMs = 16;
    let workEmaMs = 8;
    let autoTargetFps: RenderFps = 60;
    let slowStreakMs = 0;
    let fastStreakMs = 0;
    let lastStatsAtMs = 0;
    let lastReportedEffective: RenderFps | null = null;

    const renderLoop = () => {
      if (isContextLost()) {
        frameId = null;
        return;
      }
      frameId = requestAnimationFrame(renderLoop);
      const nowMs = performance.now();
      const rafDtMs = Math.max(0, nowMs - lastRafAtMs);
      lastRafAtMs = nowMs;
      rafEmaMs = rafEmaMs * 0.9 + rafDtMs * 0.1;

      const mode = getFpsMode();
      let targetFps: RenderFps;
      if (mode === "auto") {
        const isSlow = rafEmaMs > 24 || workEmaMs > 22;
        const isFast = rafEmaMs < 18 && workEmaMs < 14;
        if (autoTargetFps === 60) {
          slowStreakMs = isSlow ? slowStreakMs + rafDtMs : 0;
          if (slowStreakMs > 800) {
            autoTargetFps = 30;
            slowStreakMs = 0;
            fastStreakMs = 0;
          }
        } else {
          fastStreakMs = isFast ? fastStreakMs + rafDtMs : 0;
          if (fastStreakMs > 1500) {
            autoTargetFps = 60;
            fastStreakMs = 0;
            slowStreakMs = 0;
          }
        }
        targetFps = autoTargetFps;
      } else {
        targetFps = mode;
        autoTargetFps = mode;
        slowStreakMs = 0;
        fastStreakMs = 0;
      }

      const frameIntervalMs = 1000 / targetFps;
      accumulatedMs += rafDtMs;
      if (accumulatedMs < frameIntervalMs - FPS_EPSILON_MS) {
        if (nowMs - lastStatsAtMs > 600 || lastReportedEffective !== targetFps) {
          lastStatsAtMs = nowMs;
          lastReportedEffective = targetFps;
          setRenderFpsStats({
            effective: targetFps,
            rafEmaMs,
            workEmaMs,
          });
        }
        return;
      }

      if (accumulatedMs > frameIntervalMs * 5) {
        accumulatedMs = frameIntervalMs;
      }
      accumulatedMs = Math.max(0, accumulatedMs - frameIntervalMs);

      const workStart = performance.now();
      const rawDelta = clock.getDelta();
      const delta = Math.min(rawDelta, MAX_DELTA_SECONDS);
      const vrm = getVrm();
      if (vrm) {
        getOnFrame()?.(vrm, delta, frameContext);
        vrm.update(delta);
        getOnAfterFrame()?.(vrm, delta, frameContext);
      }
      controls.update();
      renderer.render(scene, camera);
      const workMs = Math.max(0, performance.now() - workStart);
      workEmaMs = workEmaMs * 0.9 + workMs * 0.1;

      if (nowMs - lastStatsAtMs > 600 || lastReportedEffective !== targetFps) {
        lastStatsAtMs = nowMs;
        lastReportedEffective = targetFps;
        setRenderFpsStats({
          effective: targetFps,
          rafEmaMs,
          workEmaMs,
        });
      }
    };

    frameId = requestAnimationFrame(renderLoop);
  };

  return {
    start,
    stop,
  };
};
