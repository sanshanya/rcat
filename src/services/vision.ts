/**
 * Vision service for screen capture and OCR functionality.
 *
 * Provides functions to capture screen content, extract text using Windows Native OCR,
 * and optionally analyze screen content using Vision Language Models.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Result of a screen capture and OCR operation.
 */
export interface ScreenCaptureResult {
    /** Extracted text from the screen */
    text: string;
    /** OCR confidence score (0.0 - 1.0), null if not available */
    confidence: number | null;
    /** Unix timestamp in milliseconds when the capture was taken */
    timestamp: number;
    /** Window name that was captured (if specific window) */
    window_name: string | null;
}

/**
 * Result of a VLM (Vision Language Model) analysis.
 */
export interface VlmAnalysisResult {
    /** Analysis result from the VLM */
    content: string;
    /** Unix timestamp in milliseconds */
    timestamp: number;
}

/**
 * Detailed window metadata for smart selection.
 * Windows are returned in Z-order (topmost first).
 */
export interface WindowInfo {
    /** Window title */
    title: string;
    /** Application name (e.g., "Code", "chrome") */
    app_name: string;
    /** Process ID */
    pid: number;
    /** Whether this window is currently focused */
    is_focused: boolean;
    /** Z-order index (0 = topmost, higher = further back) */
    z_index: number;
    /** Whether this window is minimized */
    is_minimized: boolean;
}

/**
 * Capture the screen and perform OCR to extract text.
 */
export async function captureScreenText(
    windowName?: string
): Promise<ScreenCaptureResult> {
    return invoke<ScreenCaptureResult>('capture_screen_text', {
        windowName: windowName ?? null,
    });
}

/**
 * Analyze the screen using a Vision Language Model.
 */
export async function analyzeScreenVlm(
    prompt: string,
    windowName?: string
): Promise<VlmAnalysisResult> {
    return invoke<VlmAnalysisResult>('analyze_screen_vlm', {
        prompt,
        windowName: windowName ?? null,
    });
}

/**
 * Get a list of visible windows with detailed metadata, sorted by Z-order.
 * 
 * Windows are returned in Z-order (topmost first), excluding:
 * - AI app windows (rcat)
 * - System windows (Program Manager, TaskBar, etc.)
 * - Minimized windows
 */
export async function listCapturableWindows(): Promise<WindowInfo[]> {
    return invoke<WindowInfo[]>('list_capturable_windows');
}

/**
 * Get the "smart" target window - the most relevant window for AI to observe.
 * 
 * Selection priority:
 * 1. The currently focused window (if not our AI window)
 * 2. The topmost non-AI window in Z-order
 */
export async function getSmartWindow(): Promise<WindowInfo | null> {
    return invoke<WindowInfo | null>('get_smart_window');
}

/**
 * Smart capture - automatically selects the most relevant window and captures it.
 * 
 * This is the recommended way to capture what the user is currently working on.
 * It automatically:
 * 1. Identifies the user's active/recent window
 * 2. Excludes system and AI windows
 * 3. Captures and performs OCR
 * 
 * @example
 * ```typescript
 * const result = await captureSmart();
 * console.log('User is looking at:', result.window_name);
 * console.log('Content:', result.text);
 * ```
 */
export async function captureSmart(): Promise<ScreenCaptureResult> {
    return invoke<ScreenCaptureResult>('capture_smart');
}

