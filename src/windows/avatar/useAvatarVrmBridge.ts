import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  EVT_VRM_COMMAND,
  EVT_VRM_STATE_REQUEST,
} from "@/constants";
import { useTauriEvent } from "@/hooks";
import { getEmotionState } from "@/components/vrm/emotionStore";
import { resetVrmEmotion, setVrmEmotion } from "@/components/vrm/emotionApi";
import { getRenderFpsState, setRenderFpsMode } from "@/components/vrm/renderFpsStore";
import { getMouseTrackingSettings, setMouseTrackingSettings } from "@/components/vrm/mouseTrackingStore";
import { getVrmHudLayoutSettings, setVrmHudLayoutSettings } from "@/components/vrm/hudLayoutStore";
import { getVrmToolMode, setVrmToolMode } from "@/components/vrm/vrmToolModeStore";
import { getVrmState } from "@/components/vrm/vrmStore";
import type { VrmCommand, VrmStateSnapshot } from "@/windows/vrmBridgeTypes";

export const useAvatarVrmBridge = () => {
  const handleVrmCommand = useCallback((event: { payload: VrmCommand }) => {
    const cmd = event.payload;
    if (!cmd || typeof cmd !== "object") return;

    const { motionController } = getVrmState();

    switch (cmd.type) {
      case "setToolMode":
        setVrmToolMode(cmd.mode);
        return;
      case "playMotion":
        if (!motionController) return;
        void motionController.playById(cmd.motionId, { loop: cmd.loop }).catch(() => {});
        return;
      case "stopMotion":
        if (!motionController) return;
        void motionController.stop().catch(() => {});
        return;
      case "setFpsMode":
        setRenderFpsMode(cmd.mode);
        return;
      case "setMouseTracking":
        setMouseTrackingSettings(cmd.settings);
        return;
      case "setHudLayout":
        setVrmHudLayoutSettings(cmd.settings);
        return;
      case "setEmotion":
        setVrmEmotion(cmd.emotion, { intensity: cmd.intensity });
        return;
      case "resetEmotion":
        resetVrmEmotion();
        return;
      default:
        return;
    }
  }, []);

  const handleStateRequest = useCallback(() => {
    const { motionController } = getVrmState();
    const fps = getRenderFpsState().mode;
    const toolMode = getVrmToolMode();
    const mouseTracking = getMouseTrackingSettings();
    const hudLayout = getVrmHudLayoutSettings();
    const emotion = getEmotionState();

    const snapshot: VrmStateSnapshot = {
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

    void invoke("vrm_state_snapshot", { snapshot }).catch(() => {});
  }, []);

  useTauriEvent<VrmCommand>(EVT_VRM_COMMAND, handleVrmCommand);
  useTauriEvent(EVT_VRM_STATE_REQUEST, handleStateRequest);
};
