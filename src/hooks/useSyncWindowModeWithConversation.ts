import { useEffect } from "react";

import type { ConversationDetail, ConversationSummary, WindowMode } from "@/types";
import { reportPromiseError } from "@/utils";

type Params = {
  windowMode: WindowMode;
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  activeConversation: ConversationDetail | null;
  messageCount: number;
  isActiveConversationGenerating: boolean;
  changeMode: (mode: WindowMode) => Promise<void>;
};

export function useSyncWindowModeWithConversation({
  windowMode,
  activeConversationId,
  conversations,
  activeConversation,
  messageCount,
  isActiveConversationGenerating,
  changeMode,
}: Params) {
  // Keep window mode aligned with the actual conversation content.
  // Without this, switching conversations can leave the app in `result` mode with an empty chat
  // (or `input` mode while there are messages), which breaks auto-fit/min-height behavior.
  useEffect(() => {
    if (windowMode === "mini") return;
    const listCount =
      conversations.find((c) => c.id === activeConversationId)?.messageCount ?? 0;
    const persistedCount =
      activeConversation?.conversation?.id === activeConversationId
        ? activeConversation.messages.length
        : 0;
    const hasConversationMessages = messageCount > 0 || persistedCount > 0;
    const desiredMode =
      hasConversationMessages || listCount > 0 || isActiveConversationGenerating
        ? "result"
        : "input";
    if (windowMode === desiredMode) return;

    void changeMode(desiredMode).catch(
      reportPromiseError("App.changeMode:syncWithMessages", {
        onceKey: "App.changeMode:syncWithMessages",
      })
    );
  }, [
    activeConversation,
    activeConversationId,
    changeMode,
    conversations,
    isActiveConversationGenerating,
    messageCount,
    windowMode,
  ]);
}

