import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VRM } from "@pixiv/three-vrm";

export type VrmRendererHandle = {
  loadVrm: (url: string, options?: { signal?: AbortSignal }) => Promise<VRM>;
  clearVrm: () => void;
};

export type VrmRendererFrameContext = {
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
};

