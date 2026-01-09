declare module "mmd-parser" {
  export class CharsetEncoder {
    s2u(array: unknown): string;
  }

  export type VmdMotion = {
    boneName: string;
    frameNum: number;
    position: number[];
    rotation: number[];
    interpolation?: number[];
  };

  export type VmdMorph = {
    morphName: string;
    frameNum: number;
    weight: number;
  };

  export type VmdFile = {
    motions: VmdMotion[];
    morphs: VmdMorph[];
    cameras?: unknown[];
    lights?: unknown[];
    shadows?: unknown[];
  };

  export class Parser {
    parseVmd(buffer: ArrayBufferLike): VmdFile;
  }
}

