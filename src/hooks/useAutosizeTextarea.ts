import { useCallback, useEffect, type RefObject } from "react";

const TEXTAREA_MAX_HEIGHT_SCREEN_RATIO = 0.25;
const MIN_TEXTAREA_MAX_HEIGHT_PX = 160;

const getTextareaMaxHeightPx = () => {
  if (typeof window === "undefined") return 200;
  const screenHeight = window.screen?.availHeight ?? window.innerHeight ?? 800;
  return Math.max(
    MIN_TEXTAREA_MAX_HEIGHT_PX,
    Math.floor(screenHeight * TEXTAREA_MAX_HEIGHT_SCREEN_RATIO)
  );
};

export function useAutosizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string
) {
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    const maxHeightPx = getTextareaMaxHeightPx();
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    autoResize(el);
  }, [autoResize, textareaRef, value]);

  return {
    autoResize,
    maxHeightPx: getTextareaMaxHeightPx(),
  };
}

