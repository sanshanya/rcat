import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { EVT_VRM_COMMAND, EVT_VRM_STATE_REQUEST } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { getEmotionState } from "@/components/vrm/emotionStore";
import { resetVrmEmotion, setVrmEmotion } from "@/components/vrm/emotionApi";
import { getRenderFpsState, setRenderFpsMode } from "@/components/vrm/renderFpsStore";
import {
  getMouseTrackingSettings,
  setMouseTrackingSettings,
} from "@/components/vrm/mouseTrackingStore";
import { getVrmHudLayoutSettings, setVrmHudLayoutSettings } from "@/components/vrm/hudLayoutStore";
import { getVrmToolMode, setVrmToolMode } from "@/components/vrm/vrmToolModeStore";
import { resetVrmAvatarTransform, resetVrmView } from "@/components/vrm/vrmRendererActions";
import { getVrmState } from "@/components/vrm/vrmStore";
import type { VrmCommand, VrmStateSnapshot } from "@/windows/vrmBridgeTypes";

export const useAvatarVrmBridge = () => {
  const snapshotTimerRef = useRef<number | null>(null);
  const lastSnapshotAtRef = useRef(0);

  const buildSnapshot = useCallback((): VrmStateSnapshot => {
    const { motionController } = getVrmState();
    const fps = getRenderFpsState().mode;
    const toolMode = getVrmToolMode();
    const mouseTracking = getMouseTrackingSettings();
    const hudLayout = getVrmHudLayoutSettings();
    const emotion = getEmotionState();

    return {
      toolMode,
      fpsMode: fps,
      mouseTracking,
      hudLayout,
      motion: {
        id: motionController?.getCurrentMotionId() ?? null,
        playing: Boolean(motionController?.isPlaying()),
      },
      emotion: {
        id: emotion.emotion,
        intensity: emotion.intensity,
      },
    };
  }, []);

  const sendSnapshotNow = useCallback(() => {
    const snapshot = buildSnapshot();
    void invoke("vrm_state_snapshot", { snapshot }).catch(() => {});
  }, [buildSnapshot]);

  const emitSnapshot = useCallback(
    (opts?: { force?: boolean }) => {
      const force = Boolean(opts?.force);
      const minIntervalMs = 100;

      if (snapshotTimerRef.current) {
        if (force) {
          window.clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = null;
        } else {
          return;
        }
      }

      const now = Date.now();
      const elapsed = now - lastSnapshotAtRef.current;

      if (force || elapsed >= minIntervalMs) {
        lastSnapshotAtRef.current = now;
        sendSnapshotNow();
        return;
      }

      snapshotTimerRef.current = window.setTimeout(() => {
        snapshotTimerRef.current = null;
        lastSnapshotAtRef.current = Date.now();
        sendSnapshotNow();
      }, Math.max(0, minIntervalMs - elapsed));
    },
    [sendSnapshotNow]
  );

  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) {
        window.clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
    };
  }, []);

  const handleVrmCommand = useCallback(
    (event: { payload: VrmCommand }) => {
      const cmd = event.payload;
      if (!cmd || typeof cmd !== "object") return;

      const { motionController } = getVrmState();

      switch (cmd.type) {
        case "setToolMode":
          setVrmToolMode(cmd.mode);
          emitSnapshot();
          return;
        case "resetView":
          resetVrmView();
          return;
        case "resetAvatarTransform":
          resetVrmAvatarTransform();
          return;
        case "playMotion":
          if (!motionController) return;
          void motionController
            .playById(cmd.motionId, { loop: cmd.loop })
            .catch(() => {})
            .finally(() => emitSnapshot({ force: true }));
          emitSnapshot();
          return;
        case "stopMotion":
          if (!motionController) return;
          void motionController
            .stop()
            .catch(() => {})
            .finally(() => emitSnapshot({ force: true }));
          emitSnapshot();
          return;
        case "setFpsMode":
          setRenderFpsMode(cmd.mode);
          emitSnapshot();
          return;
        case "setMouseTracking":
          setMouseTrackingSettings(cmd.settings);
          emitSnapshot();
          return;
        case "setHudLayout":
          setVrmHudLayoutSettings(cmd.settings);
          emitSnapshot();
          return;
        case "setEmotion":
          setVrmEmotion(cmd.emotion, { intensity: cmd.intensity });
          emitSnapshot();
          return;
        case "resetEmotion":
          resetVrmEmotion();
          emitSnapshot();
          return;
        default:
          return;
      }
    },
    [emitSnapshot]
  );

  const handleStateRequest = useCallback(() => {
    emitSnapshot({ force: true });
  }, [emitSnapshot]);

  useTauriEvent<VrmCommand>(EVT_VRM_COMMAND, handleVrmCommand);
  useTauriEvent(EVT_VRM_STATE_REQUEST, handleStateRequest);
};
