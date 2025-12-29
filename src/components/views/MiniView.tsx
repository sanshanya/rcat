import type { ComponentProps } from "react";

import { Capsule } from "@/components";

export type MiniViewProps = {
  capsuleProps: ComponentProps<typeof Capsule>;
};

export function MiniView({ capsuleProps }: MiniViewProps) {
  return <Capsule {...capsuleProps} />;
}

export default MiniView;

