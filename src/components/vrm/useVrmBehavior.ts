import { useCallback, useRef } from "react";
import { Object3D, Vector3 } from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VRMHumanBoneName } from "@pixiv/three-vrm";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { useLipSync } from "@/components/vrm/useLipSync";

type BlinkState = {
  nextBlinkAt: number;
  phase: "idle" | "closing" | "opening";
  phaseStart: number;
};

const BLINK_MIN_MS = 2000;
const BLINK_MAX_MS = 5000;
const BLINK_CLOSE_MS = 70;
const BLINK_OPEN_MS = 150;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

const randomRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

export const useVrmBehavior = () => {
  const lipSync = useLipSync();
  const vrmRef = useRef<VRM | null>(null);
  const lookAtTargetRef = useRef<Object3D | null>(null);
  const timeRef = useRef(0);
  const headRef = useRef<Object3D | null>(null);
  const headBaseRef = useRef<Vector3 | null>(null);
  const expressionDriverRef = useRef<ReturnType<typeof createExpressionDriver> | null>(null);
  const blinkRef = useRef<BlinkState>({
    nextBlinkAt: performance.now() + randomRange(BLINK_MIN_MS, BLINK_MAX_MS),
    phase: "idle",
    phaseStart: 0,
  });

  const setVrm = useCallback((vrm: VRM | null) => {
    if (vrmRef.current && lookAtTargetRef.current) {
      vrmRef.current.scene.remove(lookAtTargetRef.current);
    }
    vrmRef.current = vrm;
    headRef.current = null;
    headBaseRef.current = null;
    lookAtTargetRef.current = null;
    expressionDriverRef.current = null;

    if (!vrm) {
      lipSync.reset();
      return;
    }

    expressionDriverRef.current = createExpressionDriver(vrm.expressionManager ?? null);

    const target = new Object3D();
    target.position.set(0, 1.35, 2.0);
    vrm.scene.add(target);
    lookAtTargetRef.current = target;

    if (vrm.lookAt) {
      vrm.lookAt.target = target;
    }

    const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head) ?? null;
    headRef.current = head;
    if (head) {
      headBaseRef.current = new Vector3(
        head.rotation.x,
        head.rotation.y,
        head.rotation.z
      );
    }

    blinkRef.current = {
      nextBlinkAt: performance.now() + randomRange(BLINK_MIN_MS, BLINK_MAX_MS),
      phase: "idle",
      phaseStart: 0,
    };
    timeRef.current = 0;
    lipSync.reset();
  }, []);

  const updateBlink = useCallback((now: number) => {
    const driver = expressionDriverRef.current;
    if (!driver || !driver.supports("blink")) return;

    const state = blinkRef.current;
    let weight = 0;

    if (state.phase === "idle") {
      if (now >= state.nextBlinkAt) {
        state.phase = "closing";
        state.phaseStart = now;
      } else {
        return;
      }
    }

    if (state.phase === "closing") {
      const t = (now - state.phaseStart) / BLINK_CLOSE_MS;
      if (t >= 1) {
        weight = 1;
        state.phase = "opening";
        state.phaseStart = now;
      } else {
        weight = easeOutCubic(Math.max(0, Math.min(1, t)));
      }
    }

    if (state.phase === "opening") {
      const t = (now - state.phaseStart) / BLINK_OPEN_MS;
      if (t >= 1) {
        weight = 0;
        state.phase = "idle";
        state.nextBlinkAt = now + randomRange(BLINK_MIN_MS, BLINK_MAX_MS);
      } else {
        weight = 1 - easeInCubic(Math.max(0, Math.min(1, t)));
      }
    }

    driver.setValue("blink", weight);
  }, []);

  const updateLookAt = useCallback((time: number) => {
    const target = lookAtTargetRef.current;
    if (!target) return;

    const driftX = Math.sin(time * 0.7) * 0.15;
    const driftY = Math.sin(time * 0.9) * 0.08;
    target.position.set(driftX, 1.35 + driftY, 2.0);
  }, []);

  const updateHeadIdle = useCallback((time: number) => {
    const head = headRef.current;
    const base = headBaseRef.current;
    if (!head || !base) return;

    const pitch = Math.sin(time * 1.15) * 0.03;
    const yaw = Math.sin(time * 0.8 + 1.2) * 0.04;
    const roll = Math.sin(time * 0.9 + 2.4) * 0.015;

    head.rotation.set(base.x + pitch, base.y + yaw, base.z + roll);
  }, []);

  const onFrame = useCallback((delta: number) => {
    if (!vrmRef.current) return;
    timeRef.current += delta;
    const now = performance.now();
    updateBlink(now);
    updateLookAt(timeRef.current);
    updateHeadIdle(timeRef.current);
    const driver = expressionDriverRef.current;
    if (driver?.supports("aa")) {
      const mouth = lipSync.onFrame(delta);
      if (mouth !== null) {
        driver.setValue("aa", mouth);
      }
    }
  }, [lipSync, updateBlink, updateHeadIdle, updateLookAt]);

  return { setVrm, onFrame };
};
