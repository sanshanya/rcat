export type VrmRendererActions = {
  resetView: () => void;
  resetAvatarTransform: () => void;
};

let actions: VrmRendererActions | null = null;

export const setVrmRendererActions = (next: VrmRendererActions | null) => {
  actions = next;
};

export const resetVrmView = () => {
  actions?.resetView();
};

export const resetVrmAvatarTransform = () => {
  actions?.resetAvatarTransform();
};

