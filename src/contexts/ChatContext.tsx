import {
  createContext,
  useContext,
  type ReactNode,
  type ComponentProps,
} from "react";

import { Capsule } from "@/components";
import ChatMessages from "@/components/ChatMessages";
import PromptInput from "@/components/PromptInput";
import type { AiModel, SkinMode } from "@/types";

export type ChatContextValue = {
  capsuleProps: ComponentProps<typeof Capsule>;
  promptProps: ComponentProps<typeof PromptInput>;
  chatProps: ComponentProps<typeof ChatMessages>;
  showChat: boolean;
  modelSpec: AiModel | null;
  skinMode: SkinMode;
  errorText: string | null;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  value,
  children,
}: {
  value: ChatContextValue;
  children: ReactNode;
}) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within ChatProvider");
  }
  return ctx;
}
