import { Capsule } from "@/components";
import { useChatContext } from "@/contexts/ChatContext";

export function MiniView() {
  const { capsuleProps } = useChatContext();
  return <Capsule {...capsuleProps} />;
}

export default MiniView;
