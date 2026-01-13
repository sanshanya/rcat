import { invoke } from "@tauri-apps/api/core";

import type { SkinMode } from "@/types";

export const setSkinMode = (skin: SkinMode) => invoke("set_skin_mode", { skin });

export const openContextPanel = () => invoke("open_context_panel");

export const hideContextPanel = () => invoke("hide_context_panel");

export const scaleAvatarWindow = (factor: number) =>
  invoke("scale_avatar_window", { factor });

export const fitAvatarWindowToAspect = (aspect: number) =>
  invoke("fit_avatar_window_to_aspect", { aspect });

export type InteractionMode = "passive" | "hoverActivate" | "holdToInteract";

export const setInteractionMode = (mode: InteractionMode) =>
  invoke("set_interaction_mode", { mode });

export type AvatarInteractionBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const setAvatarInteractionBounds = (bounds: AvatarInteractionBounds | null) =>
  invoke("set_avatar_interaction_bounds", { bounds });
