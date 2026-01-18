import { Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VRM } from "@pixiv/three-vrm";

import {
  getVrmToolMode,
  subscribeVrmToolMode,
  type VrmToolMode,
} from "@/components/vrm/vrmToolModeStore";
import { AvatarWindowTransformController } from "@/components/vrm/avatarWindowTransform";
import { pushAvatarPointerInputEvent } from "@/components/vrm/avatarInteractionInputRuntime";

type VrmCanvasInputControllerOptions = {
  canvas: HTMLCanvasElement;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  getVrm: () => VRM | null;
  avatarWindowTransform: AvatarWindowTransformController | null;
  persistAvatarState: () => void;
  schedulePersistAvatarState: () => void;
};

export class VrmCanvasInputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly getVrm: () => VRM | null;
  private readonly avatarWindowTransform: AvatarWindowTransformController | null;
  private readonly persistAvatarState: () => void;
  private readonly schedulePersistAvatarState: () => void;

  private toolMode: VrmToolMode = getVrmToolMode();
  private toolModeUnsubscribe: (() => void) | null = null;

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly dragPlane = new Plane();
  private readonly dragStart = new Vector3();
  private readonly startPos = new Vector3();
  private readonly dragDelta = new Vector3();

  private dragging = false;
  private draggingPointerId: number | null = null;
  private avatarPress:
    | {
        pointerId: number;
        downClientX: number;
        downClientY: number;
        dragStarted: boolean;
      }
    | null = null;

  private static readonly AVATAR_DRAG_START_PX = 6;

  constructor(options: VrmCanvasInputControllerOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.controls = options.controls;
    this.getVrm = options.getVrm;
    this.avatarWindowTransform = options.avatarWindowTransform;
    this.persistAvatarState = options.persistAvatarState;
    this.schedulePersistAvatarState = options.schedulePersistAvatarState;

    this.updateToolMode(getVrmToolMode());
    this.toolModeUnsubscribe = subscribeVrmToolMode(() => {
      this.updateToolMode(getVrmToolMode());
    });

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);

    if (this.toolModeUnsubscribe) {
      this.toolModeUnsubscribe();
      this.toolModeUnsubscribe = null;
    }

    this.avatarWindowTransform?.dispose();
    this.dragging = false;
    this.draggingPointerId = null;
    this.avatarPress = null;
  }

  private updateToolMode(nextMode: VrmToolMode) {
    this.toolMode = nextMode;
    this.controls.enabled = nextMode === "camera";
    if (nextMode !== "model") {
      this.dragging = false;
      this.draggingPointerId = null;
    }
    if (nextMode !== "avatar") {
      this.avatarPress = null;
    }
  }

  private pointerToNdc(event: PointerEvent | WheelEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const x = ((event.clientX - rect.left) / width) * 2 - 1;
    const y = -((event.clientY - rect.top) / height) * 2 + 1;
    this.ndc.set(x, y);
    return this.ndc;
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;

    if (this.toolMode === "avatar") {
      const ndc = this.pointerToNdc(event);
      pushAvatarPointerInputEvent({
        type: "pointerDown",
        pointerId: event.pointerId,
        ndc: { x: ndc.x, y: ndc.y },
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        timeMs: performance.now(),
      });
      this.avatarPress = {
        pointerId: event.pointerId,
        downClientX: event.clientX,
        downClientY: event.clientY,
        dragStarted: false,
      };

      if (!this.avatarWindowTransform) return;
      event.preventDefault();
      this.avatarWindowTransform.handlePointerDown(event, this.canvas);
      return;
    }

    if (this.toolMode !== "model") return;
    const vrm = this.getVrm();
    if (!vrm) return;

    const ndc = this.pointerToNdc(event);
    const normal = this.camera.getWorldDirection(this.dragDelta);
    const anchor = vrm.scene.getWorldPosition(this.startPos);
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, anchor);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragStart);
    if (!hit) return;

    event.preventDefault();
    this.dragging = true;
    this.draggingPointerId = event.pointerId;
    this.startPos.copy(vrm.scene.position);
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures.
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    const avatarPress = this.avatarPress;
    if (avatarPress && avatarPress.pointerId === event.pointerId) {
      const ndc = this.pointerToNdc(event);
      pushAvatarPointerInputEvent({
        type: "pointerMove",
        pointerId: event.pointerId,
        ndc: { x: ndc.x, y: ndc.y },
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        timeMs: performance.now(),
      });

      if (!avatarPress.dragStarted) {
        const dx = event.clientX - avatarPress.downClientX;
        const dy = event.clientY - avatarPress.downClientY;
        const moved = Math.hypot(dx, dy) >= VrmCanvasInputController.AVATAR_DRAG_START_PX;
        if (moved) {
          avatarPress.dragStarted = true;
        }
      }
    }

    if (this.avatarPress?.dragStarted && this.avatarWindowTransform?.handlePointerMove(event)) {
      return;
    }

    if (!this.dragging) return;
    if (this.draggingPointerId !== event.pointerId) return;
    const vrm = this.getVrm();
    if (!vrm) return;

    const ndc = this.pointerToNdc(event);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragDelta);
    if (!hit) return;

    this.dragDelta.sub(this.dragStart);
    vrm.scene.position.copy(this.startPos).add(this.dragDelta);
    vrm.scene.updateMatrixWorld(true);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.avatarPress && this.avatarPress.pointerId === event.pointerId) {
      const ndc = this.pointerToNdc(event);
      pushAvatarPointerInputEvent({
        type: "pointerUp",
        pointerId: event.pointerId,
        ndc: { x: ndc.x, y: ndc.y },
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        timeMs: performance.now(),
      });
      this.avatarPress = null;
    }

    if (this.avatarWindowTransform?.handlePointerUp(event, this.canvas)) {
      return;
    }

    if (!this.dragging) return;
    if (this.draggingPointerId !== event.pointerId) return;

    this.dragging = false;
    this.draggingPointerId = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore capture release failures.
    }
    this.persistAvatarState();
  };

  private onWheel = (event: WheelEvent) => {
    if (this.toolMode === "avatar") {
      if (!this.avatarWindowTransform) return;
      event.preventDefault();
      this.avatarWindowTransform.queueScale(event.deltaY);
      return;
    }

    if (this.toolMode !== "model") return;
    const vrm = this.getVrm();
    if (!vrm) return;

    event.preventDefault();
    const current = vrm.scene.scale.x;
    const factor = Math.exp(-event.deltaY * 0.001);
    const next = Math.max(0.05, Math.min(10, current * factor));
    vrm.scene.scale.setScalar(next);
    vrm.scene.updateMatrixWorld(true);
    this.schedulePersistAvatarState();
  };
}
