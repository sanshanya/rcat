// src/utils/measureText.ts
// Utility for measuring text width using canvas

let cachedCanvas: HTMLCanvasElement | null = null;

function getCanvas(): HTMLCanvasElement {
  if (!cachedCanvas) {
    cachedCanvas = document.createElement("canvas");
  }
  return cachedCanvas;
}

/**
 * Measure the rendered width of text using an input/textarea element's
 * computed font (longest line wins for multiline input).
 */
export function measureTextWidth(
  text: string,
  inputElement: HTMLInputElement | HTMLTextAreaElement | null
): number {
  if (!inputElement) return 0;

  const canvas = getCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;

  const computedStyle = window.getComputedStyle(inputElement);
  ctx.font = computedStyle.font;

  const lines = text.split(/\r?\n/);
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
  }

  return maxWidth;
}

/**
 * Measure text width using explicit font specification.
 */
export function measureTextWithFont(text: string, font: string): number {
  const canvas = getCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;

  ctx.font = font;
  return ctx.measureText(text).width;
}

