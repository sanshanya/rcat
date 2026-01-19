import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AmbientLight,
  Box3,
  Clock,
  DirectionalLight,
  MOUSE,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRM } from "@pixiv/three-vrm";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import type { RenderFpsMode } from "@/components/vrm/renderFpsStore";
import { AvatarWindowTransformController } from "@/components/vrm/avatarWindowTransform";
import { setVrmRendererActions } from "@/components/vrm/vrmRendererActions";
import { VrmCanvasInputController } from "@/components/vrm/vrmCanvasInputController";
import type { VrmRendererFrameContext, VrmRendererHandle } from "@/components/vrm/vrmRendererTypes";
import {
  persistAvatarState,
  persistViewState,
  type StoredAvatarState,
  type StoredViewState,
} from "@/components/vrm/vrmPersistedState";
import { createVrmLoaderRuntime, type VrmLoaderRuntime } from "@/components/vrm/vrmLoaderRuntime";
import { createVrmRenderLoop } from "@/components/vrm/vrmRenderLoop";
import { centerObjectOnFloor, fitCameraToBox } from "@/components/vrm/vrmSceneUtils";
import { isTauriContext, reportError } from "@/utils";

export type { VrmRendererFrameContext, VrmRendererHandle } from "@/components/vrm/vrmRendererTypes";

type VrmRendererOptions = {
  onFrame?: (vrm: VRM, delta: number, ctx: VrmRendererFrameContext) => void;
  onAfterFrame?: (vrm: VRM, delta: number, ctx: VrmRendererFrameContext) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  fpsMode?: RenderFpsMode;
};

export const useVrmRenderer = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: VrmRendererOptions = {}
) => {
  const handleRef = useRef<VrmRendererHandle | null>(null);
  const [ready, setReady] = useState(false);
  const onFrameRef = useRef<VrmRendererOptions["onFrame"]>(options.onFrame);
  const onAfterFrameRef = useRef<VrmRendererOptions["onAfterFrame"]>(
    options.onAfterFrame
  );
  const onContextLostRef = useRef<VrmRendererOptions["onContextLost"]>(
    options.onContextLost
  );
  const onContextRestoredRef = useRef<VrmRendererOptions["onContextRestored"]>(
    options.onContextRestored
  );
  const fpsModeRef = useRef<RenderFpsMode>(options.fpsMode ?? "auto");

  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  useEffect(() => {
    onAfterFrameRef.current = options.onAfterFrame;
  }, [options.onAfterFrame]);

  useEffect(() => {
    onContextLostRef.current = options.onContextLost;
    onContextRestoredRef.current = options.onContextRestored;
  }, [options.onContextLost, options.onContextRestored]);

  useEffect(() => {
    fpsModeRef.current = options.fpsMode ?? "auto";
  }, [options.fpsMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;

    const scene = new Scene();
    scene.background = null;

    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 1.35, 2.5);
    camera.lookAt(0, 1.35, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.7;
    controls.panSpeed = 0.7;
    controls.mouseButtons = {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };

    const frameContext: VrmRendererFrameContext = {
      canvas,
      renderer,
      scene,
      camera,
      controls,
    };

    const keyLight = new DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(1.5, 3, 2.5);
    const fillLight = new DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-1.5, 1.8, 2.5);
    const ambient = new AmbientLight(0xffffff, 0.3);

    scene.add(keyLight);
    scene.add(fillLight);
    scene.add(ambient);

    const clock = new Clock();
    let loaderRuntime: VrmLoaderRuntime | null = null;
    let contextLost = false;
    let userAdjustedView = false;
    let isUserInteracting = false;
    let viewStateWriteTimer: number | null = null;
    let avatarStateWriteTimer: number | null = null;
    const isAvatarWebview = (() => {
      if (!isTauriContext()) return false;
      try {
        return getCurrentWebviewWindow().label === "avatar";
      } catch (err) {
        reportError(err, "useVrmRenderer.resolveWindowLabel", { devOnly: true });
        return false;
      }
    })();
    const avatarWindowTransform = isAvatarWebview ? new AvatarWindowTransformController() : null;

    const getCurrentVrm = () => loaderRuntime?.getVrm() ?? null;
    const getCurrentUrl = () => loaderRuntime?.getUrl() ?? null;

    const persistCurrentViewState = () => {
      const currentVrmUrl = getCurrentUrl();
      if (!currentVrmUrl) return;
      const position = camera.position;
      const target = controls.target;
      const viewState: StoredViewState = {
        cameraPosition: [position.x, position.y, position.z],
        target: [target.x, target.y, target.z],
      };
      persistViewState(currentVrmUrl, viewState);
    };

    const persistCurrentAvatarState = () => {
      const currentVrm = getCurrentVrm();
      const currentVrmUrl = getCurrentUrl();
      if (!currentVrm || !currentVrmUrl) return;
      const position = currentVrm.scene.position;
      const scale = currentVrm.scene.scale.x;
      const avatarState: StoredAvatarState = {
        position: [position.x, position.y, position.z],
        scale,
      };
      persistAvatarState(currentVrmUrl, avatarState);
    };

    const schedulePersistViewState = () => {
      if (typeof window === "undefined") return;
      if (!getCurrentUrl()) return;
      if (viewStateWriteTimer !== null) {
        window.clearTimeout(viewStateWriteTimer);
      }
      viewStateWriteTimer = window.setTimeout(() => {
        viewStateWriteTimer = null;
        persistCurrentViewState();
      }, 200);
    };

    const schedulePersistAvatarState = () => {
      if (typeof window === "undefined") return;
      if (!getCurrentUrl()) return;
      if (avatarStateWriteTimer !== null) {
        window.clearTimeout(avatarStateWriteTimer);
      }
      avatarStateWriteTimer = window.setTimeout(() => {
        avatarStateWriteTimer = null;
        persistCurrentAvatarState();
      }, 250);
    };

    const inputController = new VrmCanvasInputController({
      canvas,
      camera,
      controls,
      getVrm: getCurrentVrm,
      avatarWindowTransform,
      persistAvatarState: persistCurrentAvatarState,
      schedulePersistAvatarState,
    });

    const fitViewToVrm = (vrm: VRM) => {
      vrm.scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(vrm.scene);
      if (box.isEmpty()) return;

      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const span = Math.max(size.x, size.y, size.z);
      controls.minDistance = Math.max(0.05, span * 0.25);
      controls.maxDistance = Math.max(10, span * 30);

      fitCameraToBox(camera, box, { margin: 1.05 });
      controls.target.copy(center);
      controls.update();
    };

    const resetView = () => {
      const currentVrm = getCurrentVrm();
      if (!currentVrm) return;
      userAdjustedView = true;
      fitViewToVrm(currentVrm);
      persistCurrentViewState();
    };

    const resetAvatarTransform = () => {
      const currentVrm = getCurrentVrm();
      if (!currentVrm) return;
      currentVrm.scene.position.set(0, 0, 0);
      currentVrm.scene.scale.setScalar(1);
      centerObjectOnFloor(currentVrm.scene);
      currentVrm.scene.updateMatrixWorld(true);
      persistCurrentAvatarState();
    };

    setVrmRendererActions({ resetView, resetAvatarTransform });

    controls.addEventListener("start", () => {
      isUserInteracting = true;
      userAdjustedView = true;
    });
    controls.addEventListener("change", () => {
      if (!isUserInteracting) return;
      schedulePersistViewState();
    });
    controls.addEventListener("end", () => {
      isUserInteracting = false;
      schedulePersistViewState();
    });

    const resize = () => {
      const container = canvas.parentElement ?? canvas;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const vrm = getCurrentVrm();
      if (vrm && !userAdjustedView) {
        fitViewToVrm(vrm);
      } else {
        controls.update();
      }
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas.parentElement ?? canvas);
    resize();
    loaderRuntime = createVrmLoaderRuntime({
      scene,
      camera,
      controls,
      resize,
      setUserAdjustedView: (value) => {
        userAdjustedView = value;
      },
    });

    const renderLoop = createVrmRenderLoop({
      clock,
      camera,
      scene,
      renderer,
      controls,
      frameContext,
      getVrm: () => loaderRuntime?.getVrm() ?? null,
      getFpsMode: () => fpsModeRef.current,
      getOnFrame: () => onFrameRef.current,
      getOnAfterFrame: () => onAfterFrameRef.current,
      isContextLost: () => contextLost,
    });

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (contextLost) return;
      contextLost = true;
      renderLoop.stop();
      console.warn("VRM renderer: WebGL context lost");
      onContextLostRef.current?.();
    };

    const handleContextRestored = () => {
      if (!contextLost) return;
      contextLost = false;
      console.info("VRM renderer: WebGL context restored");
      onContextRestoredRef.current?.();
      renderLoop.start();
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    renderLoop.start();
    handleRef.current = { loadVrm: loaderRuntime.loadVrm, clearVrm: loaderRuntime.clearVrm };
    setReady(true);

    return () => {
      renderLoop.stop();
      setVrmRendererActions(null);
      inputController.dispose();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      resizeObserver.disconnect();
      if (viewStateWriteTimer !== null) {
        window.clearTimeout(viewStateWriteTimer);
        viewStateWriteTimer = null;
      }
      if (avatarStateWriteTimer !== null) {
        window.clearTimeout(avatarStateWriteTimer);
        avatarStateWriteTimer = null;
      }
      controls.dispose();
      loaderRuntime?.clearVrm();
      renderer.dispose();
      handleRef.current = null;
      setReady(false);
    };
  }, [canvasRef]);

  return { handleRef, ready };
};
