// src/utils/measureText.ts
// Utility for measuring text width using canvas

/** Cached canvas element for text measurement */
let cachedCanvas: HTMLCanvasElement | null = null;

/**
 * Get or create cached canvas for text measurement
 */
function getCanvas(): HTMLCanvasElement {
    if (!cachedCanvas) {
        cachedCanvas = document.createElement('canvas');
    }
    return cachedCanvas;
}

/**
 * Measure the rendered width of text using an input element's computed font.
 * Uses a cached canvas to avoid repeated DOM creation.
 *
 * @param text - The text to measure
 * @param inputElement - The input element to get font styles from
 * @returns Width in pixels
 */
export function measureTextWidth(
    text: string,
    inputElement: HTMLInputElement | null
): number {
    if (!inputElement) return 0;

    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    const computedStyle = window.getComputedStyle(inputElement);
    ctx.font = computedStyle.font;

    return ctx.measureText(text).width;
}

/**
 * Measure text width using explicit font specification
 *
 * @param text - The text to measure
 * @param font - CSS font string (e.g., "16px Inter")
 * @returns Width in pixels
 */
export function measureTextWithFont(text: string, font: string): number {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    ctx.font = font;
    return ctx.measureText(text).width;
}
