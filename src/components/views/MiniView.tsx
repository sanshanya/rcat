import { Capsule } from "@/components";
import { useChatUi } from "@/contexts/ChatUiContext";

export function MiniView() {
  const { capsuleProps } = useChatUi();
  return <Capsule {...capsuleProps} />;
}

export default MiniView;
