import { useEffect, useState } from "react";

import type { SkinMode } from "@/types";

const STORAGE_KEY = "rcat.skinMode";

const isSkinMode = (value: string | null): value is SkinMode =>
  value === "off" || value === "vrm";

const readStoredSkinMode = (): SkinMode => {
  if (typeof window === "undefined") return "off";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isSkinMode(stored)) return stored;
  } catch {
    // Ignore storage failures.
  }
  return "off";
};

export const useSkinPreference = () => {
  const [skinMode, setSkinMode] = useState<SkinMode>(readStoredSkinMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, skinMode);
    } catch {
      // Ignore storage failures.
    }
  }, [skinMode]);

  return { skinMode, setSkinMode };
};
