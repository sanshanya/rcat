import { invoke } from "@tauri-apps/api/core";

import type { WindowMode } from "@/types";

export const setWindowMode = (mode: WindowMode) =>
  invoke("set_window_mode", { mode });

export const resizeWindow = (width: number, height: number) =>
  invoke("resize_window", { width, height });

export const resizeInputHeight = (desiredHeight: number) =>
  invoke("resize_input_height", { desiredHeight });

export const setWindowMinSize = (minWidth: number, minHeight: number) =>
  invoke("set_window_min_size", { minWidth, minHeight });
