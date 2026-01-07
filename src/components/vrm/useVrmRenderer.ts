import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AmbientLight,
  Clock,
  DirectionalLight,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

export type VrmRendererHandle = {
  loadVrm: (url: string, options?: { signal?: AbortSignal }) => Promise<VRM>;
  clearVrm: () => void;
};

type VrmRendererOptions = {
  onFrame?: (vrm: VRM, delta: number) => void;
};

const CAMERA_TARGET = new Vector3(0, 1.35, 0);

const disposeMaterial = (material: Material) => {
  for (const value of Object.values(material)) {
    if (value && typeof value === "object" && (value as Texture).isTexture) {
      (value as Texture).dispose();
    }
  }
  material.dispose();
};

const disposeObject = (object: Object3D) => {
  const mesh = object as Mesh;
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  const { material } = mesh;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
  } else if (material) {
    disposeMaterial(material);
  }
};

const disposeVrm = (vrm: VRM) => {
  vrm.scene.traverse(disposeObject);
  if ("dispose" in vrm && typeof vrm.dispose === "function") {
    vrm.dispose();
  }
};

export const useVrmRenderer = (
  canvasRef: RefObject<HTMLCanvasElement>,
  options: VrmRendererOptions = {}
) => {
  const handleRef = useRef<VrmRendererHandle | null>(null);
  const [ready, setReady] = useState(false);
  const onFrameRef = useRef<VrmRendererOptions["onFrame"]>(options.onFrame);

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;

    const scene = new Scene();
    scene.background = null;

    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.35, 2.5);
    camera.lookAt(CAMERA_TARGET);

    const keyLight = new DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(1.5, 3, 2.5);
    const fillLight = new DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-1.5, 1.8, 2.5);
    const ambient = new AmbientLight(0xffffff, 0.3);

    scene.add(keyLight);
    scene.add(fillLight);
    scene.add(ambient);

    const clock = new Clock();
    let currentVrm: VRM | null = null;
    let frameId: number | null = null;

    const resize = () => {
      const container = canvas.parentElement ?? canvas;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas.parentElement ?? canvas);
    resize();

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const clearVrm = () => {
      if (!currentVrm) return;
      scene.remove(currentVrm.scene);
      disposeVrm(currentVrm);
      currentVrm = null;
    };

    const loadVrm = async (url: string, options?: { signal?: AbortSignal }) => {
      clearVrm();
      const response = await fetch(url, { signal: options?.signal });
      if (!response.ok) {
        throw new Error(`Failed to load VRM (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      const baseUrl = url.includes("/") ? url.slice(0, url.lastIndexOf("/") + 1) : "";
      const gltf = await loader.parseAsync(buffer, baseUrl);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) {
        throw new Error("VRM payload missing in glTF");
      }
      VRMUtils.rotateVRM0(vrm);
      scene.add(vrm.scene);
      currentVrm = vrm;
      return vrm;
    };

    const renderLoop = () => {
      frameId = requestAnimationFrame(renderLoop);
      const delta = clock.getDelta();
      if (currentVrm) {
        onFrameRef.current?.(currentVrm, delta);
        currentVrm.update(delta);
      }
      renderer.render(scene, camera);
    };

    renderLoop();
    handleRef.current = { loadVrm, clearVrm };
    setReady(true);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      clearVrm();
      renderer.dispose();
      handleRef.current = null;
      setReady(false);
    };
  }, [canvasRef]);

  return { handleRef, ready };
};
