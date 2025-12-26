// src/constants/window.ts
// Single source of truth for window-related constants

/** Minimum width for Input mode */
export const MIN_INPUT_WIDTH = 380;

/** Default height for Input mode (compact) */
export const INPUT_HEIGHT_COLLAPSED = 220;

/** Expanded height for Input mode (e.g. to show dropdowns) */
export const INPUT_HEIGHT_EXPANDED = 380;

/** Back-compat alias */
export const INPUT_HEIGHT = INPUT_HEIGHT_COLLAPSED;

/** Default size for Result mode */
export const DEFAULT_RESULT_SIZE = { w: 400, h: 500 };

/** Margin from screen edges */
export const EDGE_MARGIN = 12;

/** Maximum width for auto-resize during typing */
export const AUTO_RESIZE_MAX_WIDTH = 600;

/** Padding for text width calculation (includes tool buttons) */
export const INPUT_PADDING = 132; // 32(gap) + 80(icons) + 20(safe)
