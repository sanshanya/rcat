import type { PerspectiveCamera } from "three";
import type { VRM } from "@pixiv/three-vrm";

import type { AvatarZoneId } from "@/components/vrm/avatarInteractionZones";
import { AvatarZoneHitTester } from "@/components/vrm/avatarInteractionZones";
import {
  AvatarHoverReactionController,
  type AvatarHoverReactionProfile,
  type HoverReactionFrame,
} from "@/components/vrm/avatarHoverReactions";
import type { AvatarPointerInputEvent } from "@/components/vrm/avatarInteractionInputRuntime";

export type AvatarInteractionEvent =
  | { type: "zoneEnter"; zone: AvatarZoneId }
  | { type: "zoneLeave"; zone: AvatarZoneId }
  | { type: "click"; zone: AvatarZoneId | null }
  | { type: "dragStart"; zone: AvatarZoneId | null }
  | { type: "dragEnd"; zone: AvatarZoneId | null }
  | { type: "pat"; zone: AvatarZoneId | null };

export type AvatarInteractionUpdateResult = {
  zone: AvatarZoneId | null;
  distance: number | null;
  hover: HoverReactionFrame;
  events: AvatarInteractionEvent[];
  dragging: boolean;
  dragDeltaPx: { x: number; y: number };
  changed: boolean;
};

type PressState = {
  pointerId: number;
  downAtMs: number;
  downClientX: number;
  downClientY: number;
  downScreenX: number;
  downScreenY: number;
  lastClientX: number;
  lastClientY: number;
  lastScreenX: number;
  lastScreenY: number;
  lastMoveAtMs: number;
  dragStarted: boolean;
  patDistancePx: number;
  patStartedAtMs: number;
  zone: AvatarZoneId | null;
};

export class AvatarInteractionController {
  private readonly tester: AvatarZoneHitTester;
  private readonly hover: AvatarHoverReactionController;
  private press: PressState | null = null;
  private dragDeltaX = 0;
  private dragDeltaY = 0;
  private dragging = false;

  private static readonly CLICK_MAX_MS = 300;
  private static readonly DRAG_START_PX = 6;
  private static readonly PAT_TRIGGER_DISTANCE_PX = 80;
  private static readonly PAT_WINDOW_MS = 500;

  constructor(vrm: VRM, options?: { hoverProfile?: AvatarHoverReactionProfile }) {
    this.tester = new AvatarZoneHitTester(vrm);
    this.hover = new AvatarHoverReactionController(options?.hoverProfile);
  }

  update(options: {
    delta: number;
    nowMs: number;
    pointer: { x: number; y: number } | null;
    camera: PerspectiveCamera;
    pointerEvents: AvatarPointerInputEvent[];
  }): AvatarInteractionUpdateResult {
    const { delta, nowMs, pointer, camera, pointerEvents } = options;

    this.dragDeltaX = 0;
    this.dragDeltaY = 0;
    this.dragging = false;

    const prevZone = this.tester.getActiveZone();
    const hit = this.tester.hitTest({ pointer, camera });
    const nextZone = hit.zone;

    const events: AvatarInteractionEvent[] = [];
    if (prevZone !== nextZone) {
      if (prevZone) events.push({ type: "zoneLeave", zone: prevZone });
      if (nextZone) events.push({ type: "zoneEnter", zone: nextZone });
    }

    this.processPointerEvents({
      nowMs,
      zone: nextZone,
      pointerEvents,
      events,
    });

    const hover = this.hover.update({ delta, zone: nextZone });

    return {
      zone: nextZone,
      distance: hit.hit?.distance ?? null,
      hover,
      events,
      dragging: this.dragging,
      dragDeltaPx: { x: this.dragDeltaX, y: this.dragDeltaY },
      changed: hit.changed,
    };
  }

  private processPointerEvents(options: {
    nowMs: number;
    zone: AvatarZoneId | null;
    pointerEvents: AvatarPointerInputEvent[];
    events: AvatarInteractionEvent[];
  }) {
    const { nowMs, zone, pointerEvents, events } = options;
    if (!pointerEvents || pointerEvents.length === 0) {
      // Safety: if we got stuck in a pressed state (e.g. lost pointerUp), clear it.
      const press = this.press;
      if (press && nowMs - press.lastMoveAtMs > 2_000) {
        this.press = null;
      }
      return;
    }

    for (const ev of pointerEvents) {
      if (ev.type === "pointerDown") {
        if (ev.button !== 0) continue;
        this.press = {
          pointerId: ev.pointerId,
          downAtMs: ev.timeMs,
          downClientX: ev.clientX,
          downClientY: ev.clientY,
          downScreenX: ev.screenX,
          downScreenY: ev.screenY,
          lastClientX: ev.clientX,
          lastClientY: ev.clientY,
          lastScreenX: ev.screenX,
          lastScreenY: ev.screenY,
          lastMoveAtMs: ev.timeMs,
          dragStarted: false,
          patDistancePx: 0,
          patStartedAtMs: ev.timeMs,
          zone,
        };
        continue;
      }

      const press = this.press;
      if (!press) continue;
      if (press.pointerId !== ev.pointerId) continue;

      if (ev.type === "pointerMove") {
        const dx = ev.screenX - press.lastScreenX;
        const dy = ev.screenY - press.lastScreenY;
        const step = Math.hypot(dx, dy);
        press.lastClientX = ev.clientX;
        press.lastClientY = ev.clientY;
        press.lastScreenX = ev.screenX;
        press.lastScreenY = ev.screenY;
        press.lastMoveAtMs = ev.timeMs;
        press.zone = zone;

        const fromDownDx = ev.screenX - press.downScreenX;
        const fromDownDy = ev.screenY - press.downScreenY;
        const movedFromDown = Math.hypot(fromDownDx, fromDownDy);

        if (!press.dragStarted && movedFromDown >= AvatarInteractionController.DRAG_START_PX) {
          press.dragStarted = true;
          events.push({ type: "dragStart", zone });
          // Drag is exclusive: don't treat it as pat.
          press.patDistancePx = 0;
        }

        if (press.dragStarted) {
          this.dragging = true;
          this.dragDeltaX += dx;
          this.dragDeltaY += dy;
          continue;
        }

        // Pat gesture: accumulate small movements while pressed.
        press.patDistancePx += step;

        const elapsed = ev.timeMs - press.patStartedAtMs;
        const expired = elapsed > AvatarInteractionController.PAT_WINDOW_MS;
        if (expired) {
          press.patStartedAtMs = ev.timeMs;
          press.patDistancePx = 0;
          continue;
        }

        if (press.patDistancePx >= AvatarInteractionController.PAT_TRIGGER_DISTANCE_PX) {
          events.push({ type: "pat", zone });
          press.patStartedAtMs = ev.timeMs;
          press.patDistancePx = 0;
        }

        continue;
      }

      if (ev.type === "pointerUp" || ev.type === "pointerCancel") {
        const wasDragging = press.dragStarted;
        const elapsed = ev.timeMs - press.downAtMs;
        const fromDownDx = ev.screenX - press.downScreenX;
        const fromDownDy = ev.screenY - press.downScreenY;
        const movedFromDown = Math.hypot(fromDownDx, fromDownDy);

        if (wasDragging) {
          events.push({ type: "dragEnd", zone });
        } else {
          const isClick =
            elapsed <= AvatarInteractionController.CLICK_MAX_MS &&
            movedFromDown < AvatarInteractionController.DRAG_START_PX;
          if (isClick) {
            events.push({ type: "click", zone });
          }
        }

        this.press = null;
      }
    }

    if (this.press?.dragStarted) {
      this.dragging = true;
    }
  }
}
