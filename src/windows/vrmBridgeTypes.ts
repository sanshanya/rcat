import type { EmotionId } from "@/components/vrm/emotionTypes";
import type { VrmMouseTrackingSettings } from "@/components/vrm/mouseTrackingTypes";
import type { RenderFpsMode } from "@/components/vrm/renderFpsStore";
import type { VrmHudLayoutSettings } from "@/components/vrm/hudLayoutTypes";
import type { VrmToolMode } from "@/components/vrm/vrmToolModeStore";

export type PanelTabId = "chat" | "vrm" | "debug";

export type VrmStateSnapshot = {
  toolMode: VrmToolMode;
  fpsMode: RenderFpsMode;
  mouseTracking: VrmMouseTrackingSettings;
  hudLayout: VrmHudLayoutSettings;
  motion: {
    id: string | null;
    playing: boolean;
  };
  emotion: {
    id: EmotionId;
    intensity: number;
  };
};

export type VrmCommand =
  | { type: "setToolMode"; mode: VrmToolMode }
  | { type: "resetView" }
  | { type: "resetAvatarTransform" }
  | { type: "playMotion"; motionId: string; loop?: boolean }
  | { type: "stopMotion" }
  | { type: "setFpsMode"; mode: RenderFpsMode }
  | { type: "setMouseTracking"; settings: VrmMouseTrackingSettings }
  | { type: "setHudLayout"; settings: VrmHudLayoutSettings }
  | { type: "setEmotion"; emotion: EmotionId; intensity?: number }
  | { type: "resetEmotion" };
