import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AmbientLight,
  Box3,
  Clock,
  DirectionalLight,
  Material,
  MathUtils,
  MOUSE,
  Mesh,
  Object3D,
  Plane,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  VRM,
  VRMLoaderPlugin,
  VRMSpringBoneLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";

import type { RenderFps, RenderFpsMode } from "@/components/vrm/renderFpsStore";
import { setRenderFpsStats } from "@/components/vrm/renderFpsStore";
import {
  getVrmAvatarState,
  getVrmViewState,
  setVrmAvatarState,
  setVrmViewState,
} from "@/services/vrmSettings";
import { getVrmToolMode, subscribeVrmToolMode } from "@/components/vrm/vrmToolModeStore";

export type VrmRendererHandle = {
  loadVrm: (url: string, options?: { signal?: AbortSignal }) => Promise<VRM>;
  clearVrm: () => void;
};

export type VrmRendererFrameContext = {
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  controls: OrbitControls;
};

type VrmRendererOptions = {
  onFrame?: (vrm: VRM, delta: number, ctx: VrmRendererFrameContext) => void;
  onAfterFrame?: (vrm: VRM, delta: number, ctx: VrmRendererFrameContext) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  fpsMode?: RenderFpsMode;
};

const SPRING_BONE_EXTENSION = "VRMC_springBone";
const MAX_DELTA_SECONDS = 1 / 30;
const FPS_EPSILON_MS = 0.5;
const VIEW_STATE_STORAGE_PREFIX = "rcat.vrm.viewState";
const AVATAR_STATE_STORAGE_PREFIX = "rcat.vrm.avatarState";

type StoredViewState = {
  cameraPosition: [number, number, number];
  target: [number, number, number];
};

type StoredAvatarState = {
  position: [number, number, number];
  scale: number;
};

type SpringBoneSchema = {
  colliders?: unknown[];
  colliderGroups?: unknown[];
  springs?: Array<{
    joints?: unknown[];
    colliderGroups?: unknown[];
  }>;
};

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

const readPersistedViewState = async (url: string): Promise<StoredViewState | null> => {
  const persisted = await getVrmViewState(url);
  if (persisted) return persisted;
  const local = readStoredViewState(url);
  if (local) {
    void setVrmViewState(url, local).catch(() => {});
  }
  return local;
};

const readPersistedAvatarState = async (url: string): Promise<StoredAvatarState | null> => {
  const persisted = await getVrmAvatarState(url);
  if (persisted) return persisted;
  const local = readStoredAvatarState(url);
  if (local) {
    void setVrmAvatarState(url, local).catch(() => {});
  }
  return local;
};

const sanitizeSpringBone = (json: unknown) => {
  if (!json || typeof json !== "object") return false;
  const root = json as Record<string, unknown>;
  const extensions = root.extensions;
  if (!extensions || typeof extensions !== "object") return false;
  const springBone = (extensions as Record<string, unknown>)[SPRING_BONE_EXTENSION];
  if (!springBone || typeof springBone !== "object") return false;
  const schema = springBone as SpringBoneSchema;
  let patched = false;

  if (!Array.isArray(schema.colliders)) {
    schema.colliders = [];
    patched = true;
  } else {
    schema.colliders = schema.colliders.map((collider) => {
      if (isRecord(collider)) return collider;
      patched = true;
      return {
        node: -1,
        shape: { sphere: { offset: [0, 0, 0], radius: 0 } },
      };
    });
  }
  if (!Array.isArray(schema.colliderGroups)) {
    schema.colliderGroups = [];
    patched = true;
  } else {
    schema.colliderGroups = schema.colliderGroups.map((group) => {
      if (isRecord(group)) return group;
      patched = true;
      return { colliders: [] };
    });
  }
  if (!Array.isArray(schema.springs)) {
    schema.springs = [];
    patched = true;
  }

  const maxColliderGroup = Array.isArray(schema.colliderGroups)
    ? schema.colliderGroups.length
    : 0;

  schema.springs.forEach((spring, index) => {
    if (!isRecord(spring)) {
      schema.springs![index] = { joints: [] };
      patched = true;
      return;
    }
    if (!Array.isArray(spring.joints)) {
      spring.joints = [];
      patched = true;
    } else {
      const filtered = spring.joints.filter(
        (joint) => isRecord(joint) && typeof joint.node === "number"
      );
      if (filtered.length !== spring.joints.length) {
        spring.joints = filtered;
        patched = true;
      }
    }
    if (spring.colliderGroups && !Array.isArray(spring.colliderGroups)) {
      spring.colliderGroups = [];
      patched = true;
    } else if (Array.isArray(spring.colliderGroups)) {
      const filtered = spring.colliderGroups.filter(
        (group) => typeof group === "number" && group >= 0 && group < maxColliderGroup
      );
      if (filtered.length !== spring.colliderGroups.length) {
        spring.colliderGroups = filtered;
        patched = true;
      }
    }
  });

  return patched;
};

class SafeSpringBoneLoaderPlugin extends VRMSpringBoneLoaderPlugin {
  override async afterRoot(gltf: GLTF): Promise<void> {
    const patched = sanitizeSpringBone(gltf.parser.json);
    if (patched) {
      console.warn("VRM spring bone data sanitized; continuing with defaults.");
    }
    try {
      await super.afterRoot(gltf);
    } catch (err) {
      console.warn("VRM spring bone load failed; continuing without spring bones.", err);
      gltf.userData.vrmSpringBoneManager = null;
    }
  }
}

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

const centerObjectOnFloor = (object: Object3D) => {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  const minY = box.min.y;
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= minY;
  object.updateMatrixWorld(true);
  return new Box3().setFromObject(object);
};

const fitCameraToBox = (
  camera: PerspectiveCamera,
  box: Box3,
  options: { margin?: number } = {}
) => {
  if (box.isEmpty()) return;
  const margin = options.margin ?? 1.2;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  const vFov = MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distanceForHeight = (size.y / 2) / Math.tan(vFov / 2);
  const distanceForWidth = (size.x / 2) / Math.tan(hFov / 2);
  const distance = Math.max(distanceForHeight, distanceForWidth) * margin + size.z / 2;

  camera.position.set(center.x, center.y, center.z + distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(100, distance * 10);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
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
    let currentVrm: VRM | null = null;
    let currentVrmUrl: string | null = null;
    let frameId: number | null = null;
    let contextLost = false;
    let userAdjustedView = false;
    let isUserInteracting = false;
    let viewStateWriteTimer: number | null = null;
    let avatarStateWriteTimer: number | null = null;
    let hasAttachedResetListener = false;
    let toolModeUnsubscribe: (() => void) | null = null;
    let toolMode = getVrmToolMode();

    const avatarRaycaster = new Raycaster();
    const avatarNdc = new Vector2();
    const avatarDragPlane = new Plane();
    const avatarDragStart = new Vector3();
    const avatarStartPos = new Vector3();
    const avatarDragDelta = new Vector3();
    let avatarDragging = false;
    let avatarDraggingPointerId: number | null = null;

    const persistViewState = () => {
      if (!currentVrmUrl) return;
      const position = camera.position;
      const target = controls.target;
      const viewState: StoredViewState = {
        cameraPosition: [position.x, position.y, position.z],
        target: [target.x, target.y, target.z],
      };
      writeStoredViewState(currentVrmUrl, viewState);
      void setVrmViewState(currentVrmUrl, viewState).catch(() => {});
    };

    const persistAvatarState = () => {
      if (!currentVrm || !currentVrmUrl) return;
      const position = currentVrm.scene.position;
      const scale = currentVrm.scene.scale.x;
      const avatarState: StoredAvatarState = {
        position: [position.x, position.y, position.z],
        scale,
      };
      writeStoredAvatarState(currentVrmUrl, avatarState);
      void setVrmAvatarState(currentVrmUrl, avatarState).catch(() => {});
    };

    const schedulePersistViewState = () => {
      if (typeof window === "undefined") return;
      if (!currentVrmUrl) return;
      if (viewStateWriteTimer !== null) {
        window.clearTimeout(viewStateWriteTimer);
      }
      viewStateWriteTimer = window.setTimeout(() => {
        viewStateWriteTimer = null;
        persistViewState();
      }, 200);
    };

    const schedulePersistAvatarState = () => {
      if (typeof window === "undefined") return;
      if (!currentVrmUrl) return;
      if (avatarStateWriteTimer !== null) {
        window.clearTimeout(avatarStateWriteTimer);
      }
      avatarStateWriteTimer = window.setTimeout(() => {
        avatarStateWriteTimer = null;
        persistAvatarState();
      }, 250);
    };

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
      if (!currentVrm) return;
      userAdjustedView = true;
      fitViewToVrm(currentVrm);
      persistViewState();
    };

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

    const updateToolMode = (nextMode: typeof toolMode) => {
      toolMode = nextMode;
      controls.enabled = toolMode === "camera";
      if (toolMode !== "avatar") {
        avatarDragging = false;
        avatarDraggingPointerId = null;
      }
    };

    updateToolMode(toolMode);
    toolModeUnsubscribe = subscribeVrmToolMode(() => {
      updateToolMode(getVrmToolMode());
    });

    const pointerToNdc = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const x = ((event.clientX - rect.left) / width) * 2 - 1;
      const y = -((event.clientY - rect.top) / height) * 2 + 1;
      avatarNdc.set(x, y);
      return avatarNdc;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (toolMode !== "avatar") return;
      if (event.button !== 0) return;
      if (!currentVrm) return;

      const ndc = pointerToNdc(event);
      const normal = camera.getWorldDirection(avatarDragDelta);
      const anchor = currentVrm.scene.getWorldPosition(avatarStartPos);
      avatarDragPlane.setFromNormalAndCoplanarPoint(normal, anchor);
      avatarRaycaster.setFromCamera(ndc, camera);
      const hit = avatarRaycaster.ray.intersectPlane(avatarDragPlane, avatarDragStart);
      if (!hit) return;

      event.preventDefault();
      avatarDragging = true;
      avatarDraggingPointerId = event.pointerId;
      avatarStartPos.copy(currentVrm.scene.position);
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!avatarDragging) return;
      if (avatarDraggingPointerId !== event.pointerId) return;
      if (!currentVrm) return;
      const ndc = pointerToNdc(event);
      avatarRaycaster.setFromCamera(ndc, camera);
      const hit = avatarRaycaster.ray.intersectPlane(avatarDragPlane, avatarDragDelta);
      if (!hit) return;
      avatarDragDelta.sub(avatarDragStart);
      currentVrm.scene.position.copy(avatarStartPos).add(avatarDragDelta);
      currentVrm.scene.updateMatrixWorld(true);
    };

    const endAvatarDrag = (event: PointerEvent) => {
      if (!avatarDragging) return;
      if (avatarDraggingPointerId !== event.pointerId) return;
      avatarDragging = false;
      avatarDraggingPointerId = null;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore capture release failures.
      }
      persistAvatarState();
    };

    const onWheel = (event: WheelEvent) => {
      if (toolMode !== "avatar") return;
      if (!currentVrm) return;
      event.preventDefault();
      const current = currentVrm.scene.scale.x;
      const factor = Math.exp(-event.deltaY * 0.001);
      const next = Math.max(0.05, Math.min(10, current * factor));
      currentVrm.scene.scale.setScalar(next);
      currentVrm.scene.updateMatrixWorld(true);
      schedulePersistAvatarState();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endAvatarDrag);
    canvas.addEventListener("pointercancel", endAvatarDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const container = canvas.parentElement ?? canvas;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (currentVrm && !userAdjustedView) {
        fitViewToVrm(currentVrm);
      } else {
        controls.update();
      }
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas.parentElement ?? canvas);
    resize();

    if (!hasAttachedResetListener) {
      canvas.addEventListener("dblclick", resetView);
      hasAttachedResetListener = true;
    }

    const loader = new GLTFLoader();
    loader.register(
      (parser) =>
        new VRMLoaderPlugin(parser, {
          springBonePlugin: new SafeSpringBoneLoaderPlugin(parser),
        })
    );

    const clearVrm = () => {
      if (currentVrm) {
        scene.remove(currentVrm.scene);
        disposeVrm(currentVrm);
      }
      currentVrm = null;
      currentVrmUrl = null;
      userAdjustedView = false;
      avatarDragging = false;
      avatarDraggingPointerId = null;
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
        const extensionsUsed = gltf.parser?.json?.extensionsUsed ?? [];
        const extensionsRequired = gltf.parser?.json?.extensionsRequired ?? [];
        throw new Error(
          `VRM payload missing in glTF (extensionsUsed=${JSON.stringify(
            extensionsUsed
          )} extensionsRequired=${JSON.stringify(extensionsRequired)})`
        );
      }
      if (options?.signal?.aborted) {
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
      userAdjustedView = Boolean(stored);
      resize();
      if (stored) {
        applyStoredViewState(stored);
      }
      return vrm;
    };

    const startLoop = () => {
      if (frameId !== null) return;
      let lastRafAtMs = performance.now();
      let accumulatedMs = 0;
      let rafEmaMs = 16;
      let workEmaMs = 8;
      let autoTargetFps: RenderFps = 60;
      let slowStreakMs = 0;
      let fastStreakMs = 0;
      let lastStatsAtMs = 0;
      let lastReportedEffective: RenderFps | null = null;

      const renderLoop = () => {
        if (contextLost) {
          frameId = null;
          return;
        }
        frameId = requestAnimationFrame(renderLoop);
        const nowMs = performance.now();
        const rafDtMs = Math.max(0, nowMs - lastRafAtMs);
        lastRafAtMs = nowMs;
        rafEmaMs = rafEmaMs * 0.9 + rafDtMs * 0.1;

        const mode = fpsModeRef.current;
        let targetFps: RenderFps;
        if (mode === "auto") {
          const isSlow = rafEmaMs > 24 || workEmaMs > 22;
          const isFast = rafEmaMs < 18 && workEmaMs < 14;
          if (autoTargetFps === 60) {
            slowStreakMs = isSlow ? slowStreakMs + rafDtMs : 0;
            if (slowStreakMs > 800) {
              autoTargetFps = 30;
              slowStreakMs = 0;
              fastStreakMs = 0;
            }
          } else {
            fastStreakMs = isFast ? fastStreakMs + rafDtMs : 0;
            if (fastStreakMs > 1500) {
              autoTargetFps = 60;
              fastStreakMs = 0;
              slowStreakMs = 0;
            }
          }
          targetFps = autoTargetFps;
        } else {
          targetFps = mode;
          autoTargetFps = mode;
          slowStreakMs = 0;
          fastStreakMs = 0;
        }

        const frameIntervalMs = 1000 / targetFps;
        accumulatedMs += rafDtMs;
        if (accumulatedMs < frameIntervalMs - FPS_EPSILON_MS) {
          if (nowMs - lastStatsAtMs > 600 || lastReportedEffective !== targetFps) {
            lastStatsAtMs = nowMs;
            lastReportedEffective = targetFps;
            setRenderFpsStats({
              effective: targetFps,
              rafEmaMs,
              workEmaMs,
            });
          }
          return;
        }

        if (accumulatedMs > frameIntervalMs * 5) {
          // Avoid huge catch-up spikes after the tab/app is suspended.
          accumulatedMs = frameIntervalMs;
        }
        accumulatedMs = Math.max(0, accumulatedMs - frameIntervalMs);

        const workStart = performance.now();
        const rawDelta = clock.getDelta();
        const delta = Math.min(rawDelta, MAX_DELTA_SECONDS);
        if (currentVrm) {
          onFrameRef.current?.(currentVrm, delta, frameContext);
          currentVrm.update(delta);
          onAfterFrameRef.current?.(currentVrm, delta, frameContext);
        }
        controls.update();
        renderer.render(scene, camera);
        const workMs = Math.max(0, performance.now() - workStart);
        workEmaMs = workEmaMs * 0.9 + workMs * 0.1;

        if (nowMs - lastStatsAtMs > 600 || lastReportedEffective !== targetFps) {
          lastStatsAtMs = nowMs;
          lastReportedEffective = targetFps;
          setRenderFpsStats({
            effective: targetFps,
            rafEmaMs,
            workEmaMs,
          });
        }
      };

      frameId = requestAnimationFrame(renderLoop);
    };

    const stopLoop = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (contextLost) return;
      contextLost = true;
      stopLoop();
      console.warn("VRM renderer: WebGL context lost");
      onContextLostRef.current?.();
    };

    const handleContextRestored = () => {
      if (!contextLost) return;
      contextLost = false;
      console.info("VRM renderer: WebGL context restored");
      onContextRestoredRef.current?.();
      startLoop();
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    startLoop();
    handleRef.current = { loadVrm, clearVrm };
    setReady(true);

    return () => {
      stopLoop();
      if (hasAttachedResetListener) {
        canvas.removeEventListener("dblclick", resetView);
        hasAttachedResetListener = false;
      }
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endAvatarDrag);
      canvas.removeEventListener("pointercancel", endAvatarDrag);
      canvas.removeEventListener("wheel", onWheel);
      if (toolModeUnsubscribe) {
        toolModeUnsubscribe();
        toolModeUnsubscribe = null;
      }
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
      clearVrm();
      renderer.dispose();
      handleRef.current = null;
      setReady(false);
    };
  }, [canvasRef]);

  return { handleRef, ready };
};
