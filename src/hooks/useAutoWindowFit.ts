import { useCallback, useEffect, useRef, type RefObject } from "react";

import type { WindowMode } from "@/types";
import { isTauriContext, reportPromiseError } from "@/utils";
import {
  resizeInputHeight,
  resizeWindow,
  setWindowMinSize,
} from "@/services/window";

type AutoFitState = {
  mini: { w: number; h: number } | null;
  input: number | null;
  inputWidth: number | null;
  resultMin: number | null;
  resultWidth: number | null;
};

const EPS_PX = 1;
const OVERLAY_PADDING_PX = 8;

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < EPS_PX;

const createReporter = (ctx: string) =>
  reportPromiseError(`useAutoWindowFit:${ctx}`, { onceKey: `useAutoWindowFit:${ctx}` });

const reporters = {
  miniMinSize: createReporter("setWindowMinSize:mini"),
  miniResize: createReporter("resizeWindow:mini"),
  inputMinSize: createReporter("setWindowMinSize:input"),
  inputResize: createReporter("resizeInputHeight"),
  inputWidthResize: createReporter("resizeWindow:inputWidth"),
  resultMinSize: createReporter("setWindowMinSize:result"),
  resultResize: createReporter("resizeInputHeight:result"),
  resultWidthResize: createReporter("resizeWindow:resultWidth"),
} as const;

const getMaxOverlayBottom = (): number | null => {
  if (typeof document === "undefined") return null;
  const overlays = document.querySelectorAll<HTMLElement>("[data-window-overlay]");
  if (overlays.length === 0) return null;

  let maxBottom = 0;
  let hasVisible = false;
  overlays.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.height) || rect.height <= 0) return;
    if (!Number.isFinite(rect.width) || rect.width <= 0) return;
    if (!Number.isFinite(rect.bottom)) return;
    hasVisible = true;
    maxBottom = Math.max(maxBottom, rect.bottom);
  });

  return hasVisible ? maxBottom : null;
};

const hasOverlayNode = (node: Node): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  if (node.hasAttribute("data-window-overlay")) return true;
  return node.querySelector("[data-window-overlay]") !== null;
};

/**
 * Auto-fit window size to the actual rendered content size.
 *
 * Policy:
 * - `mini`: fit width + height to content (capsule) and lock min size.
 * - `input`: fit height to content and update min height (min width stays fixed).
 * - `result`: update min height to avoid clipping fixed UI (no auto-resize).
 */
export function useAutoWindowFit(
  containerRef: RefObject<HTMLElement | null>,
  mode: WindowMode,
  options: { enabled?: boolean } = {}
): void {
  const { enabled = true } = options;
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const lastAutoSizeRef = useRef<AutoFitState>({
    mini: null,
    input: null,
    inputWidth: null,
    resultMin: null,
    resultWidth: null,
  });
  const rafRef = useRef<number | null>(null);
  const allowShrinkRef = useRef(false);

  const scheduleSync = useCallback(
    (allowShrink: boolean) => {
      if (!enabledRef.current) return;
      if (!isTauriContext()) return;
      if (typeof window === "undefined") return;

      allowShrinkRef.current = allowShrinkRef.current || allowShrink;
      if (rafRef.current !== null) return;

      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        if (!enabledRef.current) return;
        const allowShrinkMerged = allowShrinkRef.current;
        allowShrinkRef.current = false;

        const currentMode = modeRef.current;
        if (currentMode !== "mini" && currentMode !== "input" && currentMode !== "result") return;

        const el = containerRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const currentHeight = window.innerHeight;
        const currentWidth = window.innerWidth;

        if (currentMode === "mini") {
          const desiredHeight = Math.ceil(rect.height);
          if (!Number.isFinite(desiredHeight) || desiredHeight <= 0) return;

          const desiredWidth = Math.ceil(rect.width);
          if (!Number.isFinite(desiredWidth) || desiredWidth <= 0) return;

          const lastSize = lastAutoSizeRef.current.mini;
          if (
            lastSize !== null
            && nearlyEqual(desiredWidth, lastSize.w)
            && nearlyEqual(desiredHeight, lastSize.h)
            && nearlyEqual(desiredWidth, currentWidth)
            && nearlyEqual(desiredHeight, currentHeight)
          ) {
            return;
          }
          lastAutoSizeRef.current.mini = { w: desiredWidth, h: desiredHeight };

          void setWindowMinSize(desiredWidth, desiredHeight).catch(reporters.miniMinSize);

          if (!allowShrinkMerged) {
            if (desiredWidth <= currentWidth + EPS_PX && desiredHeight <= currentHeight + EPS_PX) {
              return;
            }
          }

          void resizeWindow(desiredWidth, desiredHeight).catch(reporters.miniResize);
          return;
        }

        if (currentMode === "result") {
          // Compute a true minimum height by summing fixed children and the min-height
          // of flexing children (e.g. the scrollable message list).
          const children = Array.from(el.children).filter((node): node is HTMLElement => {
            if (!(node instanceof HTMLElement)) return false;
            const display = window.getComputedStyle(node).display;
            return display !== "none";
          });
          if (children.length === 0) return;

          const containerStyle = window.getComputedStyle(el);
          const gapPx = Number.parseFloat(containerStyle.rowGap || containerStyle.gap || "0") || 0;

          let total = 0;
          for (const child of children) {
            const childStyle = window.getComputedStyle(child);
            const flexGrow = Number.parseFloat(childStyle.flexGrow || "0") || 0;
            if (flexGrow > 0) {
              const minH = Number.parseFloat(childStyle.minHeight || "0") || 0;
              total += minH;
            } else {
              total += child.getBoundingClientRect().height;
            }
          }
          total += gapPx * Math.max(0, children.length - 1);

          let desiredMinHeight = Math.ceil(total);
          if (!Number.isFinite(desiredMinHeight) || desiredMinHeight <= 0) return;

          const overlayBottom = getMaxOverlayBottom();
          if (overlayBottom !== null) {
            desiredMinHeight = Math.max(
              desiredMinHeight,
              Math.ceil(overlayBottom + OVERLAY_PADDING_PX)
            );
          }

          const desiredWidth = Math.ceil(rect.width);
          const minWidth = Number.isFinite(desiredWidth) && desiredWidth > 0 ? desiredWidth : 0;

          const lastHeight = lastAutoSizeRef.current.resultMin;
          const lastWidth = lastAutoSizeRef.current.resultWidth;
          const shouldUpdateMin =
            lastHeight === null || !nearlyEqual(desiredMinHeight, lastHeight);
          const shouldUpdateWidth =
            minWidth > 0 && (lastWidth === null || !nearlyEqual(desiredWidth, lastWidth));
          if (shouldUpdateMin || shouldUpdateWidth) {
            lastAutoSizeRef.current.resultMin = desiredMinHeight;
            void setWindowMinSize(minWidth, desiredMinHeight).catch(reporters.resultMinSize);
          }

          // If the window was persisted too small (or got externally resized),
          // bump it to at least the computed minimum so content isn't clipped.
          if (currentHeight + EPS_PX < desiredMinHeight) {
            void resizeInputHeight(desiredMinHeight).catch(reporters.resultResize);
          }

          const targetHeight = Math.max(currentHeight, desiredMinHeight);

          if (Number.isFinite(desiredWidth) && desiredWidth > 0) {
            const lastWidth = lastAutoSizeRef.current.resultWidth;
            if (lastWidth === null || !nearlyEqual(desiredWidth, lastWidth)) {
              lastAutoSizeRef.current.resultWidth = desiredWidth;
            }

            if (allowShrinkMerged || desiredWidth > currentWidth + EPS_PX) {
              if (!nearlyEqual(desiredWidth, currentWidth)) {
                void resizeWindow(desiredWidth, targetHeight).catch(
                  reporters.resultWidthResize
                );
              }
            }
          }
          return;
        }

        let desiredHeight = Math.ceil(rect.height);
        if (!Number.isFinite(desiredHeight) || desiredHeight <= 0) return;

        const overlayBottom = getMaxOverlayBottom();
        if (overlayBottom !== null) {
          desiredHeight = Math.max(
            desiredHeight,
            Math.ceil(overlayBottom + OVERLAY_PADDING_PX)
          );
        }

        const desiredWidth = Math.ceil(rect.width);
        const minWidth = Number.isFinite(desiredWidth) && desiredWidth > 0 ? desiredWidth : 0;

        const lastHeight = lastAutoSizeRef.current.input;
        const lastWidth = lastAutoSizeRef.current.inputWidth;
        const heightStable =
          lastHeight !== null
          && nearlyEqual(desiredHeight, lastHeight)
          && nearlyEqual(desiredHeight, currentHeight);
        const widthStable =
          lastWidth !== null
          && Number.isFinite(desiredWidth)
          && nearlyEqual(desiredWidth, lastWidth)
          && nearlyEqual(desiredWidth, currentWidth);
        if (heightStable && widthStable) {
          return;
        }
        lastAutoSizeRef.current.input = desiredHeight;

        if (Number.isFinite(desiredWidth) && desiredWidth > 0) {
          const lastWidth = lastAutoSizeRef.current.inputWidth;
          if (lastWidth === null || !nearlyEqual(desiredWidth, lastWidth)) {
            lastAutoSizeRef.current.inputWidth = desiredWidth;
          }
          if (allowShrinkMerged || desiredWidth > currentWidth + EPS_PX) {
            if (!nearlyEqual(desiredWidth, currentWidth)) {
              void resizeWindow(desiredWidth, currentHeight).catch(
                reporters.inputWidthResize
              );
            }
          }
        }

        // Keep min-size synced to CSS-driven layout to avoid clipping on resize.
        void setWindowMinSize(minWidth, desiredHeight).catch(reporters.inputMinSize);

        if (!allowShrinkMerged) {
          if (desiredHeight <= currentHeight + EPS_PX) return;
        }

        void resizeInputHeight(desiredHeight).catch(reporters.inputResize);
      });
    },
    [containerRef]
  );

  useEffect(() => {
    if (!enabled) return;
    if (mode !== "mini" && mode !== "input" && mode !== "result") return;
    scheduleSync(true);
  }, [enabled, mode, scheduleSync]);

  useEffect(() => {
    if (!enabled) return;
    if (mode !== "mini" && mode !== "input" && mode !== "result") return;
    if (typeof ResizeObserver === "undefined") return;

    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      scheduleSync(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, enabled, mode, scheduleSync]);

  useEffect(() => {
    if (!enabled) return;
    if (mode !== "mini" && mode !== "input" && mode !== "result") return;
    if (typeof MutationObserver === "undefined") return;
    if (typeof document === "undefined") return;
    if (!document.body) return;

    const observer = new MutationObserver((mutations) => {
      const changed = mutations.some((m) => {
        return (
          Array.from(m.addedNodes).some(hasOverlayNode)
          || Array.from(m.removedNodes).some(hasOverlayNode)
        );
      });

      if (changed) {
        scheduleSync(true);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, mode, scheduleSync]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);
}
