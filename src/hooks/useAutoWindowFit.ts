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
 *
 * This hook intentionally does nothing in `result` mode.
 */
export function useAutoWindowFit(
  containerRef: RefObject<HTMLElement | null>,
  mode: WindowMode
): void {
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const lastAutoSizeRef = useRef<AutoFitState>({ mini: null, input: null });
  const rafRef = useRef<number | null>(null);
  const allowShrinkRef = useRef(false);

  const scheduleSync = useCallback(
    (allowShrink: boolean) => {
      if (!isTauriContext()) return;
      if (typeof window === "undefined") return;

      allowShrinkRef.current = allowShrinkRef.current || allowShrink;
      if (rafRef.current !== null) return;

      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const allowShrinkMerged = allowShrinkRef.current;
        allowShrinkRef.current = false;

        const currentMode = modeRef.current;
        if (currentMode !== "mini" && currentMode !== "input") return;

        const el = containerRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        let desiredHeight = Math.ceil(rect.height);
        if (!Number.isFinite(desiredHeight) || desiredHeight <= 0) return;

        const currentHeight = window.innerHeight;

        if (currentMode === "mini") {
          const desiredWidth = Math.ceil(rect.width);
          if (!Number.isFinite(desiredWidth) || desiredWidth <= 0) return;

          const currentWidth = window.innerWidth;
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

        const overlayBottom = getMaxOverlayBottom();
        if (overlayBottom !== null) {
          desiredHeight = Math.max(
            desiredHeight,
            Math.ceil(overlayBottom + OVERLAY_PADDING_PX)
          );
        }

        const lastHeight = lastAutoSizeRef.current.input;
        if (
          lastHeight !== null
          && nearlyEqual(desiredHeight, lastHeight)
          && nearlyEqual(desiredHeight, currentHeight)
        ) {
          return;
        }
        lastAutoSizeRef.current.input = desiredHeight;

        // Only update min-height here. Min-width is owned by Rust (per-mode constraints),
        // so we pass 0 to avoid duplicating constants in TS.
        void setWindowMinSize(0, desiredHeight).catch(reporters.inputMinSize);

        if (!allowShrinkMerged) {
          if (desiredHeight <= currentHeight + EPS_PX) return;
        }

        void resizeInputHeight(desiredHeight).catch(reporters.inputResize);
      });
    },
    [containerRef]
  );

  useEffect(() => {
    if (mode !== "mini" && mode !== "input") return;
    scheduleSync(true);
  }, [mode, scheduleSync]);

  useEffect(() => {
    if (mode !== "mini" && mode !== "input") return;
    if (typeof ResizeObserver === "undefined") return;

    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      scheduleSync(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, mode, scheduleSync]);

  useEffect(() => {
    if (mode !== "mini" && mode !== "input") return;
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
  }, [mode, scheduleSync]);

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
