import { useCallback, type RefObject } from "react";

import type {
  ConversationDetail,
  ConversationSummary,
  WindowMode,
} from "@/types";
import { reportPromiseError } from "@/utils";

type UseToggleExpandParams = {
  windowMode: WindowMode;
  changeMode: (mode: WindowMode) => Promise<void>;
  resetWindow: () => void;
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  activeConversation: ConversationDetail | null;
  uiMessageCount: number;
  isActiveConversationGenerating: boolean;
  markSeen: (conversationId: string) => Promise<void>;
  setInputValue: (value: string) => void;
  goMainRoute: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function useToggleExpand({
  windowMode,
  changeMode,
  resetWindow,
  activeConversationId,
  conversations,
  activeConversation,
  uiMessageCount,
  isActiveConversationGenerating,
  markSeen,
  setInputValue,
  goMainRoute,
  inputRef,
}: UseToggleExpandParams) {
  const collapse = useCallback(() => {
    setInputValue("");
    goMainRoute();
    resetWindow();
  }, [goMainRoute, resetWindow, setInputValue]);

  const toggleExpand = useCallback(async () => {
    if (windowMode !== "mini") {
      if (activeConversationId) {
        void markSeen(activeConversationId).catch(
          reportPromiseError("App.markSeen:collapse", {
            onceKey: "App.markSeen:collapse",
          })
        );
      }
      collapse();
      return;
    }

    const listCount =
      conversations.find((c) => c.id === activeConversationId)?.messageCount ??
      0;
    const persistedCount =
      activeConversation?.conversation?.id === activeConversationId
        ? activeConversation.messages.length
        : 0;
    const hasConversationMessages =
      uiMessageCount > 0 || listCount > 0 || persistedCount > 0;
    const nextMode =
      hasConversationMessages || isActiveConversationGenerating
        ? "result"
        : "input";
    await changeMode(nextMode);

    if (activeConversationId) {
      void markSeen(activeConversationId).catch(
        reportPromiseError("App.markSeen:expand", {
          onceKey: "App.markSeen:expand",
        })
      );
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [
    activeConversation,
    activeConversationId,
    changeMode,
    collapse,
    conversations,
    inputRef,
    isActiveConversationGenerating,
    markSeen,
    uiMessageCount,
    windowMode,
  ]);

  return {
    collapse,
    toggleExpand,
  };
}
