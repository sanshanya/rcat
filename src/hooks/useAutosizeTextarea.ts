import { useCallback, useEffect, type RefObject } from "react";

export function useAutosizeTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string
) {
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    autoResize(el);
  }, [autoResize, textareaRef, value]);

  return {
    autoResize,
  };
}
