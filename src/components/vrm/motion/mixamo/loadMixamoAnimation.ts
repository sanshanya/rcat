import type { VRM } from "@pixiv/three-vrm";
import {
  AnimationClip,
  type KeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

import { mixamoVrmRigMap } from "@/components/vrm/motion/mixamo/mixamoVrmRigMap";
import { readMotionDebugLogsFromStorage } from "@/components/vrm/motion/motionDebug";

/**
 * Load Mixamo FBX animation, retarget it for three-vrm normalized bones, and return it.
 *
 * Expects Mixamo skeleton names like `mixamorigHips`.
 */
export async function loadMixamoAnimation(
  url: string,
  vrm: VRM
): Promise<AnimationClip | null> {
  const loader = new FBXLoader();
  const asset = await loader.loadAsync(url);
  const clip =
    AnimationClip.findByName(asset.animations, "mixamo.com") ?? asset.animations[0];
  if (!clip) return null;

  const tracks: KeyframeTrack[] = [];
  const restRotationInverse = new Quaternion();
  const parentRestWorldRotation = new Quaternion();
  const quat = new Quaternion();

  const motionHips = asset.getObjectByName("mixamorigHips");
  const motionHipsHeight = motionHips?.position.y ?? 1;
  // Use a deterministic rest-pose measurement.
  // Reading world positions here makes retargeting depend on the current animation pose / scene scale,
  // which creates motion-order dependent drift when clips are loaded asynchronously.
  const restPose = vrm.humanoid?.normalizedRestPose as
    | Record<string, { position?: number[] } | undefined>
    | undefined;
  const restHipsY = restPose?.hips?.position?.[1];
  const vrmHipsHeight =
    typeof restHipsY === "number" && Number.isFinite(restHipsY) && restHipsY !== 0
      ? Math.abs(restHipsY)
      : Math.abs(vrm.humanoid?.getNormalizedBoneNode("hips")?.position.y ?? 1);
  const hipsPositionScale = motionHipsHeight !== 0 ? vrmHipsHeight / motionHipsHeight : 1;
  if (readMotionDebugLogsFromStorage()) {
    console.debug("[mixamo] retarget scale", {
      url,
      motionHipsHeight,
      restHipsY,
      vrmHipsHeight,
      hipsPositionScale,
    });
  }

  clip.tracks.forEach((track) => {
    const [mixamoRigName, propertyName] = track.name.split(".");
    if (!mixamoRigName || !propertyName) return;
    const vrmBoneName = mixamoVrmRigMap[mixamoRigName];
    const vrmNodeName = vrmBoneName
      ? vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name
      : null;
    if (!vrmNodeName) return;

    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (mixamoRigNode) {
      mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
      if (mixamoRigNode.parent) {
        mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
      } else {
        parentRestWorldRotation.identity();
      }
    } else {
      restRotationInverse.identity();
      parentRestWorldRotation.identity();
    }

    if (track instanceof QuaternionKeyframeTrack) {
      const values = new Float32Array(track.values.length);
      values.set(track.values);

      for (let i = 0; i < values.length; i += 4) {
        quat.fromArray(values, i);
        quat.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        quat.toArray(values, i);
      }

      if (vrm.meta.metaVersion === "0") {
        for (let i = 0; i < values.length; i += 1) {
          if (i % 2 === 0) values[i] = -values[i];
        }
      }

      tracks.push(new QuaternionKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, values));
      return;
    }

    if (track instanceof VectorKeyframeTrack) {
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < values.length; i += 1) {
        const signed =
          vrm.meta.metaVersion === "0" && i % 3 !== 1 ? -track.values[i] : track.values[i];
        values[i] = signed * hipsPositionScale;
      }
      tracks.push(new VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, values));
    }
  });

  return new AnimationClip("mixamo", clip.duration, tracks);
}
