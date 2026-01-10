import type { VRM } from "@pixiv/three-vrm";
import { InterpolateLinear } from "three";

import { bindToVRM, convert } from "./vmd2vrmanim.binding";
import { getVmdMotionSettings } from "@/components/vrm/vmdSettingsStore";

export const loadVmdAnimation = async (url: string, vrm: VRM) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load VMD (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  const animation = convert(buffer, vrm);
  const vmdSettings = getVmdMotionSettings();
  const clip = bindToVRM(animation, vrm, {
    includeFingers: vmdSettings.includeFingers,
    enableIK: vmdSettings.enableIk,
  });
  if (!clip) return null;
  clip.tracks.forEach((track) => track.setInterpolation(InterpolateLinear));
  return clip;
};
