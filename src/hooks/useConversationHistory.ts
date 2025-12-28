import { useCallback, useEffect, useState } from "react";

import type { ConversationDetail, ConversationSummary } from "@/types";
import {
  historyBootstrap,
  historyClearConversation,
  historyDeleteConversation,
  historyGetConversation,
  historyListConversations,
  historyMarkSeen,
  historyNewConversation,
  historySetActiveConversation,
} from "@/services/history";
import { isTauriContext, reportPromiseError } from "@/utils";

type ConversationHistoryState = {
  isReady: boolean;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversation: ConversationDetail | null;
};

export function useConversationHistory() {
  const [state, setState] = useState<ConversationHistoryState>({
    isReady: false,
    conversations: [],
    activeConversationId: null,
    activeConversation: null,
  });

  const refreshList = useCallback(async () => {
    if (!isTauriContext()) return [];
    const conversations = await historyListConversations();
    setState((prev) => ({ ...prev, conversations }));
    return conversations;
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    if (!isTauriContext()) return null;
    const detail = await historyGetConversation(conversationId);
    setState((prev) => ({
      ...prev,
      activeConversationId: conversationId,
      activeConversation: detail,
    }));
    return detail;
  }, []);

  const bootstrap = useCallback(async () => {
    if (!isTauriContext()) {
      setState((prev) => ({ ...prev, isReady: true }));
      return;
    }

    const boot = await historyBootstrap();
    setState((prev) => ({
      ...prev,
      conversations: boot.conversations,
      activeConversationId: boot.activeConversationId,
      isReady: true,
    }));
    await loadConversation(boot.activeConversationId);
  }, [loadConversation]);

  useEffect(() => {
    void bootstrap().catch(
      reportPromiseError("useConversationHistory.bootstrap", {
        onceKey: "useConversationHistory.bootstrap",
      })
    );
  }, [bootstrap]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (!isTauriContext()) return;
      await historySetActiveConversation(conversationId);
      await loadConversation(conversationId);
      await refreshList();
    },
    [loadConversation, refreshList]
  );

  const newConversation = useCallback(async () => {
    if (!isTauriContext()) return null;
    const created = await historyNewConversation();
    await loadConversation(created.id);
    await refreshList();
    return created;
  }, [loadConversation, refreshList]);

  const markSeen = useCallback(
    async (conversationId: string) => {
      if (!isTauriContext()) return;
      await historyMarkSeen(conversationId);
      await refreshList();
    },
    [refreshList]
  );

  const clearConversation = useCallback(
    async (conversationId: string) => {
      if (!isTauriContext()) return;
      await historyClearConversation(conversationId);
      await loadConversation(conversationId);
      await refreshList();
    },
    [loadConversation, refreshList]
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      if (!isTauriContext()) return null;
      const boot = await historyDeleteConversation(conversationId);
      setState((prev) => ({
        ...prev,
        conversations: boot.conversations,
        activeConversationId: boot.activeConversationId,
      }));
      await loadConversation(boot.activeConversationId);
      return boot;
    },
    [loadConversation]
  );

  return {
    ...state,
    refreshList,
    loadConversation,
    selectConversation,
    newConversation,
    markSeen,
    clearConversation,
    deleteConversation,
  };
}
