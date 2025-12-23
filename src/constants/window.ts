// src/constants/window.ts
// Single source of truth for window-related constants

/** Minimum width for Input mode (matches capsule width) */
export const MIN_INPUT_WIDTH = 220;

/** Default height for Input mode */
export const INPUT_HEIGHT = 140;

/** Default size for Result mode */
export const DEFAULT_RESULT_SIZE = { w: 400, h: 500 };

/** Margin from screen edges */
export const EDGE_MARGIN = 12;

/** Maximum width for auto-resize during typing */
export const AUTO_RESIZE_MAX_WIDTH = 600;

/** Padding for text width calculation */
export const INPUT_PADDING = 92; // 32(gap) + 40(icon) + 20(safe)
