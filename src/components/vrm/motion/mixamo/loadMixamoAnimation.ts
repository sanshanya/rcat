import type { VRM } from "@pixiv/three-vrm";
import {
  AnimationClip,
  type KeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

import { mixamoVrmRigMap } from "@/components/vrm/motion/mixamo/mixamoVrmRigMap";

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
  const vec3 = new Vector3();

  const motionHips = asset.getObjectByName("mixamorigHips");
  const motionHipsHeight = motionHips?.position.y ?? 1;
  const vrmHipsY = vrm.humanoid?.getNormalizedBoneNode("hips")?.getWorldPosition(vec3).y ?? 0;
  const vrmRootY = vrm.scene.getWorldPosition(vec3).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
  const hipsPositionScale = motionHipsHeight !== 0 ? vrmHipsHeight / motionHipsHeight : 1;

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

