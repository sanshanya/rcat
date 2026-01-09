import type { VRM } from "@pixiv/three-vrm";
import type { AnimationClip } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { VRMAnimationLoaderPlugin } from "@/components/vrm/motion/vrma/VRMAnimationLoaderPlugin";
import type { VRMAnimation } from "@/components/vrm/motion/vrma/VRMAnimation";

const loader = new GLTFLoader();
loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

export async function loadVrmAnimation(
  url: string,
  vrm: VRM
): Promise<AnimationClip | null> {
  const gltf = await loader.loadAsync(url);
  const animations = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined) ?? [];
  const first = animations[0];
  return first ? first.createAnimationClip(vrm) : null;
}

