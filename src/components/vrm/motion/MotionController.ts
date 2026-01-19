import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

import { loadMixamoAnimation } from "@/components/vrm/motion/mixamo/loadMixamoAnimation";
import { applyDesktopInPlaceRootMotion } from "@/components/vrm/motion/desktopRootMotion";
import { FootPlantIkController, type FootPlantIkDebugInfo } from "@/components/vrm/motion/footPlantIk";
import { loadVrmAnimation } from "@/components/vrm/motion/vrma/loadVrmAnimation";
import { loadVmdAnimation } from "@/components/vrm/motion/vmd/loadVmdAnimation";
import VRMIKHandler from "@/components/vrm/motion/vmd/vrmIkHandler";
import { getMotionEntryById, type MotionEntry } from "./motionCatalog";
import { getVmdMotionSettings } from "@/components/vrm/vmdSettingsStore";
import { readMotionDebugLogsFromStorage } from "@/components/vrm/motion/motionDebug";

type MotionPlayOptions = {
  loop?: boolean;
  fadeIn?: number;
};

type MotionControllerOptions = {
  onStopped?: () => void;
};

export class MotionController {
  private vrm: VRM;
  private mixer: AnimationMixer;
  private currentAction: AnimationAction | null = null;
  private currentMotionId: string | null = null;
  private currentMotionType: MotionEntry["type"] | null = null;
  private currentVmdIkTracks = {
    leftFoot: false,
    rightFoot: false,
    leftToes: false,
    rightToes: false,
  };
  private currentLoop = false;
  private onStopped?: () => void;
  private preloadedMotions = new Map<string, AnimationClip>();
  private embeddedClips = new Map<string, AnimationClip>();
  private embeddedEntries: MotionEntry[] = [];
  private ikHandler: VRMIKHandler | null = null;
  private footIk: FootPlantIkController | null = null;
  private restPose = new Map<VRMHumanBoneName, Quaternion>();
  private baseHipsPosition = new Vector3();
  private debugPendingSnapshot: { id: string; type: MotionEntry["type"]; reason: string } | null =
    null;
  private debugLastVmdIkEnabled: boolean | null = null;
  private smoothBones: Array<{ boneName: VRMHumanBoneName; node: Object3D; quaternion: Quaternion }> = [];
  private smoothingNeedsReset = true;
  private smoothingTauSeconds = 0.12;
  private smoothingExcludedBones = new Set<VRMHumanBoneName>([
    VRMHumanBoneName.Hips,
    VRMHumanBoneName.LeftUpperLeg,
    VRMHumanBoneName.LeftLowerLeg,
    VRMHumanBoneName.LeftFoot,
    VRMHumanBoneName.LeftToes,
    VRMHumanBoneName.RightUpperLeg,
    VRMHumanBoneName.RightLowerLeg,
    VRMHumanBoneName.RightFoot,
    VRMHumanBoneName.RightToes,
  ]);

  constructor(vrm: VRM, options: MotionControllerOptions = {}) {
    this.vrm = vrm;
    this.mixer = new AnimationMixer(vrm.scene);
    this.onStopped = options.onStopped;
    this.mixer.addEventListener("finished", this.handleFinished);
    this.footIk = new FootPlantIkController(vrm);
    this.captureRestPose();
    const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
    if (hips) {
      this.baseHipsPosition.copy(hips.position);
    }
  }

  public dispose() {
    this.mixer.removeEventListener("finished", this.handleFinished);
    this.stop(false);
  }

  public getCurrentMotionId() {
    return this.currentMotionId;
  }

  public setFootPlantEnabled(enabled: boolean) {
    this.footIk?.setEnabled(enabled);
  }

  public getFootPlantDebugInfo(): FootPlantIkDebugInfo | null {
    return this.footIk?.getDebugInfo() ?? null;
  }

  public getEmbeddedEntries() {
    return this.embeddedEntries;
  }

  public setEmbeddedClips(clips: AnimationClip[] | null | undefined) {
    this.embeddedClips.clear();
    this.embeddedEntries = [];
    if (!Array.isArray(clips) || clips.length === 0) return;
    clips.forEach((clip, index) => {
      if (!clip) return;
      const label = typeof clip.name === "string" && clip.name.trim().length > 0
        ? clip.name.trim()
        : `Embedded ${index + 1}`;
      const id = `embedded:${index}`;
      this.embeddedClips.set(id, clip);
      this.embeddedEntries.push({
        id,
        name: label,
        type: "embedded",
        path: id,
        loop: true,
        category: "Embedded",
      });
    });
  }

  public isPlaying() {
    return Boolean(this.currentAction);
  }

  private async resolveEntryById(id: string) {
    const embedded = this.embeddedEntries.find((entry) => entry.id === id) ?? null;
    if (embedded) return embedded;
    return await getMotionEntryById(id);
  }

  public async preloadById(id: string) {
    const entry = await this.resolveEntryById(id);
    if (!entry) return null;
    return await this.preloadEntry(entry);
  }

  public async playById(id: string, options: MotionPlayOptions = {}) {
    const entry = await this.resolveEntryById(id);
    if (!entry) {
      console.warn(`Motion not found: ${id}`);
      return false;
    }
    return await this.playEntry(entry, options);
  }

  public async stop(notify: boolean = true) {
    if (this.currentAction) {
      this.currentAction.stop();
    }
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
    this.currentAction = null;
    this.currentMotionId = null;
    this.currentMotionType = null;
    this.currentVmdIkTracks = {
      leftFoot: false,
      rightFoot: false,
      leftToes: false,
      rightToes: false,
    };
    this.currentLoop = false;
    this.smoothingNeedsReset = true;
    this.footIk?.reset();
    this.ikHandler?.disableAll();
    // Preserve rest pose baseline (used for VMD clip completion).
    if (notify) {
      this.onStopped?.();
    }
  }

  public update(delta: number) {
    this.mixer.update(delta);
  }

  public postUpdate(delta: number) {
    const motionType = this.currentMotionType;
    if (!motionType) return;
    if (motionType !== "vmd") {
      if (motionType === "fbx") {
        this.footIk?.update(delta);
      }
      this.flushMotionDebugSnapshot(delta);
      return;
    }
    const vmdSettings = getVmdMotionSettings();
    this.smoothingTauSeconds = vmdSettings.smoothingTauSeconds;
    if (this.ikHandler) {
      const hasIkTracks =
        this.currentVmdIkTracks.leftFoot ||
        this.currentVmdIkTracks.rightFoot ||
        this.currentVmdIkTracks.leftToes ||
        this.currentVmdIkTracks.rightToes;
      const enableIk = vmdSettings.enableIk && hasIkTracks;
      if (enableIk) {
        // Avoid stale targets from previous motion types by only enabling IK chains
        // that are actually animated by this clip.
        this.ikHandler.disableAll();
        if (this.currentVmdIkTracks.leftFoot) {
          this.ikHandler.getAndEnableIK(VRMHumanBoneName.LeftFoot);
        }
        if (this.currentVmdIkTracks.rightFoot) {
          this.ikHandler.getAndEnableIK(VRMHumanBoneName.RightFoot);
        }
        if (this.currentVmdIkTracks.leftToes) {
          this.ikHandler.getAndEnableIK(VRMHumanBoneName.LeftToes);
        }
        if (this.currentVmdIkTracks.rightToes) {
          this.ikHandler.getAndEnableIK(VRMHumanBoneName.RightToes);
        }
        this.vrm.scene.updateMatrixWorld(true);
        this.ikHandler.update();
      } else {
        this.ikHandler.disableAll();
      }
      if (readMotionDebugLogsFromStorage() && enableIk !== this.debugLastVmdIkEnabled) {
        this.debugLastVmdIkEnabled = enableIk;
        console.debug("[motion] vmd ik", {
          enabled: enableIk,
          tracks: { ...this.currentVmdIkTracks },
        });
      }
    }
    this.applySmoothing(delta);
    this.flushMotionDebugSnapshot(delta);
  }

  private ensureSmoothingInitialized() {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;
    if (this.smoothBones.length === 0) {
      const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
      boneNames.forEach((boneName) => {
        const node = humanoid.getRawBoneNode(boneName);
        if (!node) return;
        this.smoothBones.push({
          boneName,
          node,
          quaternion: node.quaternion.clone(),
        });
      });
    }
    if (this.smoothingNeedsReset) {
      this.smoothBones.forEach((entry) => {
        entry.quaternion.copy(entry.node.quaternion);
      });
      this.smoothingNeedsReset = false;
    }
  }

  private applySmoothing(delta: number) {
    this.ensureSmoothingInitialized();
    if (this.smoothBones.length === 0) return;
    if (delta <= 0) return;
    const tau = Math.max(0.001, this.smoothingTauSeconds);
    const alpha = 1 - Math.exp(-delta / tau);
    this.smoothBones.forEach((entry) => {
      if (this.smoothingExcludedBones.has(entry.boneName)) {
        // Keep excluded bones crisp (especially legs/hips for grounded motions).
        // Still update internal state so re-enabling smoothing won't "jump".
        entry.quaternion.copy(entry.node.quaternion);
        return;
      }
      entry.quaternion.slerp(entry.node.quaternion, alpha);
      entry.node.quaternion.copy(entry.quaternion);
    });
  }

  private async preloadEntry(entry: MotionEntry) {
    if (this.preloadedMotions.has(entry.path)) {
      return this.preloadedMotions.get(entry.path) ?? null;
    }
    const clip = await this.loadMotionClip(entry);
    if (clip) {
      this.preloadedMotions.set(entry.path, clip);
    }
    return clip ?? null;
  }

  private async playEntry(entry: MotionEntry, options: MotionPlayOptions) {
    const clip = await this.preloadEntry(entry);
    if (!clip) {
      console.warn(`Failed to load motion: ${entry.id}`);
      return false;
    }

    const previousType = this.currentMotionType;
    const previousMotionId = this.currentMotionId;
    const debugLogs = readMotionDebugLogsFromStorage();
    if (entry.type !== "vmd" && this.ikHandler) {
      this.ikHandler.disableAll();
      this.ikHandler = null;
    }
    this.footIk?.reset();

    const loop = typeof options.loop === "boolean" ? options.loop : entry.loop ?? true;
    const fadeIn = options.fadeIn ?? 0.2;

    const restPoseFilled = this.ensureClipCoversHumanoid(clip);
    if (restPoseFilled) {
      this.mixer.uncacheClip(clip);
    }

    this.currentVmdIkTracks =
      entry.type === "vmd"
        ? this.getVmdIkTrackInfo(clip)
        : {
            leftFoot: false,
            rightFoot: false,
            leftToes: false,
            rightToes: false,
          };

    let previousAction = this.currentAction;
    const previousId = this.currentMotionId;
    const shouldReuseAction = Boolean(previousAction && previousId === entry.id);
    const allowCrossFade = Boolean(
      previousAction && !shouldReuseAction && fadeIn > 0 && previousType === entry.type
    );

    let didHardReset = false;
    if (previousAction && !shouldReuseAction) {
      if (!allowCrossFade && previousType && previousType !== entry.type) {
        // Switching motion systems (FBX/VRMA/VMD/embedded) should not carry over AnimationMixer
        // binding state. Clearing cached bindings makes pose evaluation deterministic across
        // motion types (fixes FBX↔VMD order-dependent foot drift / offsets).
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this.vrm.scene);
        this.vrm.humanoid?.resetNormalizedPose();
        this.vrm.scene.updateMatrixWorld(true);
        previousAction = null;
        didHardReset = true;
      } else if (!allowCrossFade) {
        previousAction.stop();
        // Flush pose updates from the stopped action (and any post-IK writes) so the next motion
        // anchors from a stable state instead of inheriting the previous motion's last frame.
        this.mixer.update(0);
      }
    }

    const action = shouldReuseAction && previousAction ? previousAction : this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = true;
    if (!shouldReuseAction && previousAction && allowCrossFade) {
      previousAction.crossFadeTo(action, fadeIn, false);
    } else if (fadeIn > 0) {
      action.fadeIn(fadeIn);
    }

    if (entry.type !== "vmd") {
      applyDesktopInPlaceRootMotion(
        clip,
        this.vrm,
        entry.type === "fbx" ? "lock-horizontal" : "remove-net-displacement",
        this.baseHipsPosition
      );
    }

    if (debugLogs) {
      console.groupCollapsed?.(`[motion] play ${entry.id} (${entry.type})`);
      console.debug("[motion] transition", {
        from: previousMotionId ? `${previousMotionId} (${previousType ?? "?"})` : null,
        to: `${entry.id} (${entry.type})`,
        didHardReset,
      });
      console.debug("[motion] humanoid", {
        autoUpdateHumanBones: this.vrm.humanoid?.autoUpdateHumanBones ?? null,
      });
      console.debug("[motion] clip", {
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.length,
        restPoseFilled,
        vmdIkTracks: entry.type === "vmd" ? { ...this.currentVmdIkTracks } : null,
      });
      const humanoid = this.vrm.humanoid;
      if (humanoid) {
        const hasTrack = (node: Object3D, property: "position" | "quaternion") => {
          return (
            clip.tracks.some((t) => t.name === `${node.name}.${property}`) ||
            clip.tracks.some((t) => t.name === `${node.uuid}.${property}`)
          );
        };
        const bones: VRMHumanBoneName[] = [
          VRMHumanBoneName.Hips,
          VRMHumanBoneName.LeftUpperLeg,
          VRMHumanBoneName.LeftLowerLeg,
          VRMHumanBoneName.LeftFoot,
          VRMHumanBoneName.LeftToes,
          VRMHumanBoneName.RightUpperLeg,
          VRMHumanBoneName.RightLowerLeg,
          VRMHumanBoneName.RightFoot,
          VRMHumanBoneName.RightToes,
        ];
        const coverage = Object.fromEntries(
          bones.map((boneName) => {
            const node = humanoid.getNormalizedBoneNode(boneName);
            if (!node) return [boneName, null];
            return [
              boneName,
              {
                quaternion: hasTrack(node, "quaternion"),
                position: hasTrack(node, "position"),
              },
            ];
          })
        );
        console.debug("[motion] trackCoverage(normalized)", coverage);
      }
      const hips = this.vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
      if (hips) {
        const nameTrack = `${hips.name}.position`;
        const uuidTrack = `${hips.uuid}.position`;
        const track = clip.tracks.find((t) => t.name === nameTrack || t.name === uuidTrack);
        if (track instanceof VectorKeyframeTrack) {
          const values = track.values;
          const first = values.length >= 3 ? [values[0], values[1], values[2]] : null;
          const lastIndex = values.length - 3;
          const last = lastIndex >= 0 ? [values[lastIndex], values[lastIndex + 1], values[lastIndex + 2]] : null;
          console.debug("[motion] hips.position(track)", { trackName: track.name, first, last });
        } else {
          console.debug("[motion] hips.position(track)", { trackName: nameTrack, present: false });
        }
      }
      console.groupEnd?.();
    }

    action.play();
    if (entry.type === "fbx") {
      // Prime after the first pose is applied, otherwise we might sample the previous motion pose.
      this.mixer.update(0);
      this.footIk?.primeFromCurrentPose();
    }

    this.currentAction = action;
    this.currentMotionId = entry.id;
    this.currentMotionType = entry.type;
    this.currentLoop = loop;
    this.smoothingNeedsReset = entry.type === "vmd";
    this.scheduleMotionDebugSnapshot("play");

    return true;
  }

  private getVmdIkTrackInfo(clip: AnimationClip) {
    const info = {
      leftFoot: false,
      rightFoot: false,
      leftToes: false,
      rightToes: false,
    };
    for (const track of clip.tracks) {
      const name = track.name;
      if (name.startsWith(`${VRMHumanBoneName.LeftFoot}IK.`)) info.leftFoot = true;
      else if (name.startsWith(`${VRMHumanBoneName.RightFoot}IK.`)) info.rightFoot = true;
      else if (name.startsWith(`${VRMHumanBoneName.LeftToes}IK.`)) info.leftToes = true;
      else if (name.startsWith(`${VRMHumanBoneName.RightToes}IK.`)) info.rightToes = true;
      if (info.leftFoot && info.rightFoot && info.leftToes && info.rightToes) break;
    }
    return info;
  }

  private captureRestPose() {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;
    (Object.values(VRMHumanBoneName) as VRMHumanBoneName[]).forEach((boneName) => {
      const node = humanoid.getNormalizedBoneNode(boneName) ?? null;
      if (!node) return;
      this.restPose.set(boneName, node.quaternion.clone());
    });
  }

  private scheduleMotionDebugSnapshot(reason: string) {
    if (!readMotionDebugLogsFromStorage()) return;
    const id = this.currentMotionId;
    const type = this.currentMotionType;
    if (!id || !type) return;
    this.debugPendingSnapshot = { id, type, reason };
  }

  private flushMotionDebugSnapshot(delta: number) {
    const pending = this.debugPendingSnapshot;
    if (!pending) return;
    if (!readMotionDebugLogsFromStorage()) {
      this.debugPendingSnapshot = null;
      return;
    }
    if (this.currentMotionId !== pending.id || this.currentMotionType !== pending.type) {
      this.debugPendingSnapshot = null;
      return;
    }
    this.debugPendingSnapshot = null;
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;
    const toV3 = (v: Vector3 | null) => (v ? [v.x, v.y, v.z] : null);
    const vec3 = new Vector3();
    const vec3b = new Vector3();
    const vec3c = new Vector3();
    const vec3d = new Vector3();

    const scene = this.vrm.scene;
    scene.updateMatrixWorld(true);
    const rawHips = humanoid.getRawBoneNode(VRMHumanBoneName.Hips);
    const normHips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const rawLeftFoot = humanoid.getRawBoneNode(VRMHumanBoneName.LeftFoot);
    const rawRightFoot = humanoid.getRawBoneNode(VRMHumanBoneName.RightFoot);
    const rawLeftToes = humanoid.getRawBoneNode(VRMHumanBoneName.LeftToes);
    const rawRightToes = humanoid.getRawBoneNode(VRMHumanBoneName.RightToes);
    const normLeftFoot = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftFoot);
    const normRightFoot = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightFoot);
    const normLeftToes = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftToes);
    const normRightToes = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightToes);

    const ik = VRMIKHandler.get(this.vrm);
    const leftFootTarget = ik.getExistingTarget(VRMHumanBoneName.LeftFoot) ?? null;
    const rightFootTarget = ik.getExistingTarget(VRMHumanBoneName.RightFoot) ?? null;
    const leftToesTarget = ik.getExistingTarget(VRMHumanBoneName.LeftToes) ?? null;
    const rightToesTarget = ik.getExistingTarget(VRMHumanBoneName.RightToes) ?? null;

    console.debug("[motion] snapshot", {
      id: pending.id,
      type: pending.type,
      reason: pending.reason,
      delta,
      scene: {
        position: toV3(scene.position),
        scale: toV3(scene.scale),
      },
      hips: {
        base: toV3(this.baseHipsPosition),
        normalized: normHips
          ? {
              local: toV3(normHips.position),
              world: toV3(normHips.getWorldPosition(vec3)),
            }
          : null,
        raw: rawHips
          ? {
              local: toV3(rawHips.position),
              world: toV3(rawHips.getWorldPosition(vec3b)),
            }
          : null,
      },
      feet: {
        normalized: {
          leftFoot: normLeftFoot ? toV3(normLeftFoot.getWorldPosition(vec3c)) : null,
          rightFoot: normRightFoot ? toV3(normRightFoot.getWorldPosition(vec3d)) : null,
          leftToes: normLeftToes ? toV3(normLeftToes.getWorldPosition(new Vector3())) : null,
          rightToes: normRightToes ? toV3(normRightToes.getWorldPosition(new Vector3())) : null,
        },
        raw: {
          leftFoot: rawLeftFoot ? toV3(rawLeftFoot.getWorldPosition(new Vector3())) : null,
          rightFoot: rawRightFoot ? toV3(rawRightFoot.getWorldPosition(new Vector3())) : null,
          leftToes: rawLeftToes ? toV3(rawLeftToes.getWorldPosition(new Vector3())) : null,
          rightToes: rawRightToes ? toV3(rawRightToes.getWorldPosition(new Vector3())) : null,
        },
        targets: {
          leftFoot: leftFootTarget ? toV3(leftFootTarget.getWorldPosition(new Vector3())) : null,
          rightFoot: rightFootTarget ? toV3(rightFootTarget.getWorldPosition(new Vector3())) : null,
          leftToes: leftToesTarget ? toV3(leftToesTarget.getWorldPosition(new Vector3())) : null,
          rightToes: rightToesTarget ? toV3(rightToesTarget.getWorldPosition(new Vector3())) : null,
        },
      },
      footPlant: this.getFootPlantDebugInfo(),
    });
  }

  /**
   * Some animation clips are sparse (e.g. only upper-body bones, or missing toes).
   * Three.js will keep the last value for properties without tracks, which makes motion switching
   * order-dependent (FBX↔VMD drift). Complete missing tracks with a rest pose so playback is
   * deterministic.
   */
  private ensureClipCoversHumanoid(clip: AnimationClip) {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return false;

    const duration = Math.max(1e-3, clip.duration);
    const times = [0, duration];
    const existing = new Set<string>(clip.tracks.map((track) => track.name));
    let changed = false;

    (Object.values(VRMHumanBoneName) as VRMHumanBoneName[]).forEach((boneName) => {
      const node = humanoid.getNormalizedBoneNode(boneName) ?? null;
      if (!node) return;
      const nameTrack = `${node.name}.quaternion`;
      const uuidTrack = `${node.uuid}.quaternion`;
      if (existing.has(nameTrack) || existing.has(uuidTrack)) return;

      const rest = this.restPose.get(boneName) ?? node.quaternion;
      const values = [
        rest.x,
        rest.y,
        rest.z,
        rest.w,
        rest.x,
        rest.y,
        rest.z,
        rest.w,
      ];
      clip.tracks.push(new QuaternionKeyframeTrack(nameTrack, times, values));
      existing.add(nameTrack);
      changed = true;
    });

    const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
    if (hips) {
      const nameTrack = `${hips.name}.position`;
      const uuidTrack = `${hips.uuid}.position`;
      if (!existing.has(nameTrack) && !existing.has(uuidTrack)) {
        const base = this.baseHipsPosition;
        const values = [base.x, base.y, base.z, base.x, base.y, base.z];
        clip.tracks.push(new VectorKeyframeTrack(nameTrack, times, values));
        existing.add(nameTrack);
        changed = true;
      }
    }

    return changed;
  }

  private async loadMotionClip(entry: MotionEntry) {
    switch (entry.type) {
      case "fbx":
        return await loadMixamoAnimation(entry.path, this.vrm);
      case "vrma":
      case "glb":
      case "gltf":
        return await loadVrmAnimation(entry.path, this.vrm);
      case "embedded":
        return this.embeddedClips.get(entry.path) ?? null;
      case "vmd":
        this.ikHandler = VRMIKHandler.get(this.vrm);
        return await loadVmdAnimation(entry.path, this.vrm);
      default:
        return null;
    }
  }

  private handleFinished = () => {
    if (this.currentLoop) return;
    this.currentAction = null;
    this.currentMotionId = null;
    this.currentMotionType = null;
    this.currentLoop = false;
    this.smoothingNeedsReset = true;
    this.onStopped?.();
  };
}
