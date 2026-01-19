import {
  getVrmAvatarState,
  getVrmViewState,
  setVrmAvatarState,
  setVrmViewState,
} from "@/services/vrmSettings";

export type StoredViewState = {
  cameraPosition: [number, number, number];
  target: [number, number, number];
};

export type StoredAvatarState = {
  position: [number, number, number];
  scale: number;
};

const VIEW_STATE_STORAGE_PREFIX = "rcat.vrm.viewState";
const AVATAR_STATE_STORAGE_PREFIX = "rcat.vrm.avatarState";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isVec3Tuple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => isFiniteNumber(entry));

const isAvatarScale = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0.01 && value < 100;

const viewStateStorageKey = (url: string) =>
  `${VIEW_STATE_STORAGE_PREFIX}:${encodeURIComponent(url)}`;

const avatarStateStorageKey = (url: string) =>
  `${AVATAR_STATE_STORAGE_PREFIX}:${encodeURIComponent(url)}`;

const readStoredViewState = (url: string): StoredViewState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(viewStateStorageKey(url));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const cameraPosition = parsed.cameraPosition;
    const target = parsed.target;
    if (!isVec3Tuple(cameraPosition) || !isVec3Tuple(target)) return null;
    return { cameraPosition, target };
  } catch {
    return null;
  }
};

const readStoredAvatarState = (url: string): StoredAvatarState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(avatarStateStorageKey(url));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const position = parsed.position;
    const scale = parsed.scale;
    if (!isVec3Tuple(position) || !isAvatarScale(scale)) return null;
    return { position, scale };
  } catch {
    return null;
  }
};

const writeStoredViewState = (url: string, viewState: StoredViewState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(viewStateStorageKey(url), JSON.stringify(viewState));
  } catch {
    // Ignore storage failures.
  }
};

const writeStoredAvatarState = (url: string, avatarState: StoredAvatarState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(avatarStateStorageKey(url), JSON.stringify(avatarState));
  } catch {
    // Ignore storage failures.
  }
};

export const readPersistedViewState = async (url: string): Promise<StoredViewState | null> => {
  const persisted = await getVrmViewState(url);
  if (persisted) return persisted;
  const local = readStoredViewState(url);
  if (local) {
    void setVrmViewState(url, local).catch(() => {});
  }
  return local;
};

export const readPersistedAvatarState = async (
  url: string
): Promise<StoredAvatarState | null> => {
  const persisted = await getVrmAvatarState(url);
  if (persisted) return persisted;
  const local = readStoredAvatarState(url);
  if (local) {
    void setVrmAvatarState(url, local).catch(() => {});
  }
  return local;
};

export const persistViewState = (url: string, viewState: StoredViewState) => {
  writeStoredViewState(url, viewState);
  void setVrmViewState(url, viewState).catch(() => {});
};

export const persistAvatarState = (url: string, avatarState: StoredAvatarState) => {
  writeStoredAvatarState(url, avatarState);
  void setVrmAvatarState(url, avatarState).catch(() => {});
};

