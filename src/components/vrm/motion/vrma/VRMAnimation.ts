import type { VRM, VRMExpressionManager, VRMHumanBoneName } from "@pixiv/three-vrm";
import {
  AnimationClip,
  type KeyframeTrack,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";

export class VRMAnimation {
  duration = 0;
  restHipsPosition = new Vector3();

  humanoidTracks: {
    translation: Map<VRMHumanBoneName, VectorKeyframeTrack>;
    rotation: Map<VRMHumanBoneName, QuaternionKeyframeTrack>;
  } = {
    translation: new Map(),
    rotation: new Map(),
  };

  expressionTracks: Map<string, NumberKeyframeTrack> = new Map();
  lookAtTrack: QuaternionKeyframeTrack | null = null;

  createAnimationClip(vrm: VRM): AnimationClip {
    const tracks: KeyframeTrack[] = [];

    tracks.push(...this.createHumanoidTracks(vrm));

    if (vrm.expressionManager) {
      tracks.push(...this.createExpressionTracks(vrm.expressionManager));
    }

    if (vrm.lookAt) {
      const track = this.createLookAtTrack("lookAtTargetParent.quaternion");
      if (track) tracks.push(track);
    }

    return new AnimationClip("Clip", this.duration, tracks);
  }

  createHumanoidTracks(vrm: VRM): KeyframeTrack[] {
    const humanoid = vrm.humanoid;
    const metaVersion = vrm.meta.metaVersion;
    const tracks: KeyframeTrack[] = [];

    for (const [name, origTrack] of this.humanoidTracks.rotation.entries()) {
      const nodeName = humanoid.getNormalizedBoneNode(name)?.name;
      if (!nodeName) continue;
      const signedValues = new Float32Array(origTrack.values.length);
      for (let i = 0; i < signedValues.length; i += 1) {
        const value = origTrack.values[i];
        signedValues[i] = metaVersion === "0" && i % 2 === 0 ? -value : value;
      }
      const track = new QuaternionKeyframeTrack(
        `${nodeName}.quaternion`,
        origTrack.times,
        signedValues
      );
      tracks.push(track);
    }

    for (const [name, origTrack] of this.humanoidTracks.translation.entries()) {
      const nodeName = humanoid.getNormalizedBoneNode(name)?.name;
      if (!nodeName) continue;
      const animationY = this.restHipsPosition.y;
      const humanoidY = humanoid.getNormalizedAbsolutePose().hips!.position![1];
      const scale = animationY !== 0 ? humanoidY / animationY : 1;

      const track = origTrack.clone();
      track.values = new Float32Array(
        Array.from(track.values).map(
          (value, index) =>
            (metaVersion === "0" && index % 3 !== 1 ? -value : value) * scale
        )
      );
      track.name = `${nodeName}.position`;
      tracks.push(track);
    }

    return tracks;
  }

  createExpressionTracks(expressionManager: VRMExpressionManager): KeyframeTrack[] {
    const tracks: KeyframeTrack[] = [];

    for (const [name, origTrack] of this.expressionTracks.entries()) {
      const trackName = expressionManager.getExpressionTrackName(name);
      if (!trackName) continue;
      const track = origTrack.clone();
      track.name = trackName;
      tracks.push(track);
    }

    return tracks;
  }

  createLookAtTrack(trackName: string): KeyframeTrack | null {
    if (!this.lookAtTrack) return null;
    const track = this.lookAtTrack.clone();
    track.name = trackName;
    return track;
  }
}
