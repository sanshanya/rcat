import type { PerspectiveCamera } from "three";

import type { AvatarMouseTracking } from "@/components/vrm/AvatarMouseTracking";
import { getMouseTrackingSettings } from "@/components/vrm/mouseTrackingStore";
import {
  computeTrackingPermissionsTarget,
  TrackingPermissionController,
} from "@/components/vrm/trackingPermissions";
import {
  getGazeRuntimeDebug,
  setGazeRuntimeDebug,
  type GazeSource,
} from "@/components/vrm/useGazeDebug";
import type { VrmToolMode } from "@/components/vrm/vrmToolModeStore";

type Vec2 = { x: number; y: number };

export type AvatarGazeFrame = {
  pointer: Vec2 | null;
  source: GazeSource;
};

export class AvatarGazeController {
  private localPointer: Vec2 | null = null;
  private globalPointer: Vec2 | null = null;

  private debugAtMs = 0;
  private debug: { x: number; y: number; source: GazeSource } = {
    x: 0,
    y: 0,
    source: "drift",
  };

  private permissions = new TrackingPermissionController();

  reset() {
    this.localPointer = null;
    this.globalPointer = null;
    this.debugAtMs = 0;
    this.debug = { x: 0, y: 0, source: "drift" };
    this.permissions = new TrackingPermissionController();
  }

  setLocalPointerFromClient(clientX: number, clientY: number, viewW: number, viewH: number) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    if (!Number.isFinite(viewW) || viewW <= 0) return;
    if (!Number.isFinite(viewH) || viewH <= 0) return;

    this.localPointer = {
      x: (clientX / viewW) * 2 - 1,
      y: 1 - (clientY / viewH) * 2,
    };
  }

  setGlobalPointer(pointer: Vec2 | null) {
    this.globalPointer = pointer;
  }

  update(options: {
    delta: number;
    time: number;
    nowMs: number;
    toolMode: VrmToolMode;
    motionActive: boolean;
    speaking: boolean;
    camera: PerspectiveCamera | null;
    tracker: AvatarMouseTracking | null;
  }): AvatarGazeFrame {
    const { delta, time, nowMs, toolMode, motionActive, speaking, camera, tracker } = options;

    const result = this.pickPointer();
    const pointerX = result.pointer ? result.pointer.x : 0;
    const pointerY = result.pointer ? result.pointer.y : 0;

    const prev = this.debug;
    const changed =
      result.source !== prev.source ||
      Math.abs(pointerX - prev.x) > 0.01 ||
      Math.abs(pointerY - prev.y) > 0.01;
    if (changed || nowMs - this.debugAtMs > 200) {
      this.debug = { x: pointerX, y: pointerY, source: result.source };
      this.debugAtMs = nowMs;
      setGazeRuntimeDebug({
        x: pointerX,
        y: pointerY,
        source: result.source,
        updatedAt: nowMs,
      });
    }

    if (tracker) {
      const permissionsTarget = computeTrackingPermissionsTarget({
        motionActive,
        speaking,
        toolMode,
      });
      const permissions = this.permissions.update(delta, permissionsTarget);
      tracker.update({
        delta,
        time,
        pointer: result.pointer,
        camera,
        settings: getMouseTrackingSettings(),
        headWeight: permissions.headWeight,
        spineWeight: permissions.spineWeight,
        eyesWeight: permissions.eyesWeight,
        allowRestPoseOverride: !motionActive,
      });
    }

    return result;
  }

  private pickPointer(): AvatarGazeFrame {
    const debugState = getGazeRuntimeDebug();
    if (debugState.manualEnabled) {
      return {
        pointer: { x: debugState.manualX, y: debugState.manualY },
        source: "manual",
      };
    }

    // Prefer global cursor tracking when available (desk-pet behavior).
    if (this.globalPointer) {
      return { pointer: this.globalPointer, source: "global" };
    }

    if (this.localPointer) {
      return { pointer: this.localPointer, source: "local" };
    }

    return { pointer: null, source: "drift" };
  }
}

