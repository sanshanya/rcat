import { Box3, Vector3, type PerspectiveCamera, type Scene } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

import {
  readPersistedAvatarState,
  readPersistedViewState,
  type StoredAvatarState,
  type StoredViewState,
} from "@/components/vrm/vrmPersistedState";
import { SafeSpringBoneLoaderPlugin } from "@/components/vrm/vrmSpringBonePlugin";
import { centerObjectOnFloor, disposeVrm } from "@/components/vrm/vrmSceneUtils";

export type VrmLoaderRuntime = {
  getVrm: () => VRM | null;
  getUrl: () => string | null;
  clearVrm: () => void;
  loadVrm: (url: string, options?: { signal?: AbortSignal }) => Promise<VRM>;
};

export const createVrmLoaderRuntime = (options: {
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  resize: () => void;
  setUserAdjustedView: (value: boolean) => void;
}): VrmLoaderRuntime => {
  const { scene, camera, controls } = options;

  const loader = new GLTFLoader();
  loader.register(
    (parser) =>
      new VRMLoaderPlugin(parser, {
        springBonePlugin: new SafeSpringBoneLoaderPlugin(parser),
      })
  );

  let currentVrm: VRM | null = null;
  let currentVrmUrl: string | null = null;

  const applyStoredViewState = (stored: StoredViewState) => {
    camera.position.set(
      stored.cameraPosition[0],
      stored.cameraPosition[1],
      stored.cameraPosition[2]
    );
    controls.target.set(stored.target[0], stored.target[1], stored.target[2]);
    const distance = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = Math.max(100, distance * 10);
    camera.updateProjectionMatrix();
    controls.update();
  };

  const applyStoredAvatarState = (vrm: VRM, stored: StoredAvatarState) => {
    vrm.scene.position.set(stored.position[0], stored.position[1], stored.position[2]);
    const nextScale = Math.max(0.05, Math.min(10, stored.scale));
    vrm.scene.scale.setScalar(nextScale);
    vrm.scene.updateMatrixWorld(true);
  };

  const clearVrm = () => {
    if (currentVrm) {
      scene.remove(currentVrm.scene);
      disposeVrm(currentVrm);
    }
    currentVrm = null;
    currentVrmUrl = null;
    options.setUserAdjustedView(false);
  };

  const loadVrm = async (url: string, loadOptions?: { signal?: AbortSignal }) => {
    clearVrm();
    const response = await fetch(url, { signal: loadOptions?.signal });
    if (!response.ok) {
      throw new Error(`Failed to load VRM (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    const baseUrl = url.includes("/") ? url.slice(0, url.lastIndexOf("/") + 1) : "";
    const gltf = await loader.parseAsync(buffer, baseUrl);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      const extensionsUsed = gltf.parser?.json?.extensionsUsed ?? [];
      const extensionsRequired = gltf.parser?.json?.extensionsRequired ?? [];
      throw new Error(
        `VRM payload missing in glTF (extensionsUsed=${JSON.stringify(
          extensionsUsed
        )} extensionsRequired=${JSON.stringify(extensionsRequired)})`
      );
    }
    if (loadOptions?.signal?.aborted) {
      disposeVrm(vrm);
      throw new DOMException("Aborted", "AbortError");
    }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    (vrm.scene.userData as Record<string, unknown>).__rcatEmbeddedAnimations =
      gltf.animations ?? [];
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
    vrm.scene.updateMatrixWorld(true);
    centerObjectOnFloor(vrm.scene);
    scene.add(vrm.scene);
    currentVrm = vrm;
    currentVrmUrl = url;

    vrm.scene.updateMatrixWorld(true);
    const limitsBox = new Box3().setFromObject(vrm.scene);
    if (!limitsBox.isEmpty()) {
      const size = limitsBox.getSize(new Vector3());
      const span = Math.max(size.x, size.y, size.z);
      controls.minDistance = Math.max(0.05, span * 0.25);
      controls.maxDistance = Math.max(10, span * 30);
    }

    const storedAvatar = await readPersistedAvatarState(url);
    if (storedAvatar) {
      applyStoredAvatarState(vrm, storedAvatar);
    }

    const stored = await readPersistedViewState(url);
    options.setUserAdjustedView(Boolean(stored));
    options.resize();
    if (stored) {
      applyStoredViewState(stored);
    }

    return vrm;
  };

  return {
    getVrm: () => currentVrm,
    getUrl: () => currentVrmUrl,
    clearVrm,
    loadVrm,
  };
};

