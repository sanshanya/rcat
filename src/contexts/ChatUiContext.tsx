import {
  createContext,
  useContext,
  type ReactNode,
  type ComponentProps,
} from "react";

import { Capsule } from "@/components";
import ChatMessages from "@/components/ChatMessages";
import PromptInput from "@/components/PromptInput";
import type { AiModel } from "@/types";

export type ChatUiContextValue = {
  capsuleProps: ComponentProps<typeof Capsule>;
  promptProps: ComponentProps<typeof PromptInput>;
  chatProps: ComponentProps<typeof ChatMessages>;
  showChat: boolean;
  modelSpec: AiModel | null;
};

const ChatUiContext = createContext<ChatUiContextValue | null>(null);

export function ChatUiProvider({
  value,
  children,
}: {
  value: ChatUiContextValue;
  children: ReactNode;
}) {
  return (
    <ChatUiContext.Provider value={value}>{children}</ChatUiContext.Provider>
  );
}

export function useChatUi(): ChatUiContextValue {
  const ctx = useContext(ChatUiContext);
  if (!ctx) {
    throw new Error("useChatUi must be used within ChatUiProvider");
  }
  return ctx;
}
