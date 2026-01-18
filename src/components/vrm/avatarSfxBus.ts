export type AvatarSfxId = "dragStart" | "dragEnd" | "click" | "pat";

export type AvatarSfxBus = {
  play: (id: AvatarSfxId) => void;
};

const NOOP_BUS: AvatarSfxBus = {
  play: () => {},
};

let bus: AvatarSfxBus = NOOP_BUS;

export const setAvatarSfxBus = (next: AvatarSfxBus | null) => {
  bus = next ?? NOOP_BUS;
};

export const playAvatarSfx = (id: AvatarSfxId) => {
  bus.play(id);
};

