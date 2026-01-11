import { useEffect, useState } from "react";

export type MotionFileType = "fbx" | "vrma" | "vmd" | "glb" | "gltf" | "embedded";

export type MotionEntry = {
  id: string;
  name: string;
  type: MotionFileType;
  path: string;
  loop?: boolean;
  category?: string;
};

const DEFAULT_CATALOG_URL = "/vrm/motions/index.json";

const catalogCache = new Map<string, Promise<MotionEntry[]>>();

const isRemoteUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeType = (value: unknown): MotionFileType | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "fbx" ||
    normalized === "vrma" ||
    normalized === "vmd" ||
    normalized === "glb" ||
    normalized === "gltf" ||
    normalized === "embedded"
  ) {
    return normalized;
  }
  return null;
};

const normalizeEntry = (raw: unknown): MotionEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as {
    id?: unknown;
    name?: unknown;
    type?: unknown;
    path?: unknown;
    loop?: unknown;
    category?: unknown;
  };
  if (typeof item.id !== "string" || item.id.trim().length === 0) return null;
  if (typeof item.name !== "string" || item.name.trim().length === 0) return null;
  const type = normalizeType(item.type);
  if (!type) return null;
  if (typeof item.path !== "string" || item.path.trim().length === 0) return null;
  const path = item.path.trim();
  if (isRemoteUrl(path)) {
    console.warn("Motion catalog entry skipped (remote url disabled):", item.id);
    return null;
  }
  return {
    id: item.id.trim(),
    name: item.name.trim(),
    type,
    path,
    loop: typeof item.loop === "boolean" ? item.loop : undefined,
    category: typeof item.category === "string" ? item.category.trim() : undefined,
  };
};

export const loadMotionCatalog = (url: string = DEFAULT_CATALOG_URL) => {
  const cached = catalogCache.get(url);
  if (cached) return cached;
  const task = fetch(url)
    .then((res) => (res.ok ? res.json() : []))
    .then((payload) => {
      if (!Array.isArray(payload)) return [];
      const items = payload
        .map(normalizeEntry)
        .filter((entry): entry is MotionEntry => Boolean(entry));
      return items;
    })
    .catch((err) => {
      console.warn("Failed to load motion catalog:", err);
      return [] as MotionEntry[];
    });
  catalogCache.set(url, task);
  return task;
};

export const getMotionEntryById = async (id: string, url?: string) => {
  const list = await loadMotionCatalog(url);
  return list.find((entry) => entry.id === id) ?? null;
};

export const useMotionCatalog = () => {
  const [items, setItems] = useState<MotionEntry[]>([]);

  useEffect(() => {
    let active = true;
    loadMotionCatalog().then((list) => {
      if (!active) return;
      setItems(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return items;
};
