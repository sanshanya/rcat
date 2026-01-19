import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationDetail, ConversationSummary } from "@/types";
import {
  historyBootstrap,
  historyClearConversation,
  historyDeleteConversation,
  historyForkConversation,
  historyGetConversationPage,
  historyListConversations,
  historyMarkSeen,
  historyNewConversation,
  historyRenameConversation,
  historySetActiveConversation,
} from "@/services/history";
import { isTauriContext, reportPromiseError } from "@/utils";

type ConversationHistoryState = {
  isReady: boolean;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversation: ConversationDetail | null;
};

const HISTORY_PAGE_SIZE = 80;

export function useConversationHistory() {
  const [state, setState] = useState<ConversationHistoryState>({
    isReady: false,
    conversations: [],
    activeConversationId: null,
    activeConversation: null,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshList = useCallback(async () => {
    if (!isTauriContext()) return [];
    const conversations = await historyListConversations();
    setState((prev) => ({ ...prev, conversations }));
    return conversations;
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    if (!isTauriContext()) return null;
    const detail = await historyGetConversationPage(conversationId, null, HISTORY_PAGE_SIZE);
    setState((prev) => ({
      ...prev,
      activeConversationId: conversationId,
      activeConversation: detail,
    }));
    return detail;
  }, []);

  const loadOlderMessages = useCallback(async (conversationId: string) => {
    if (!isTauriContext()) return null;
    const snapshot = stateRef.current;
    if (snapshot.activeConversationId !== conversationId || !snapshot.activeConversation)
      return null;

    const beforeSeq = snapshot.activeConversation.messages[0]?.seq ?? null;
    if (!beforeSeq || beforeSeq <= 1) return null;

    const page = await historyGetConversationPage(
      conversationId,
      beforeSeq,
      HISTORY_PAGE_SIZE
    );
    setState((prev) => {
      if (prev.activeConversationId !== conversationId || !prev.activeConversation) return prev;

      const existing = prev.activeConversation.messages;
      const existingIds = new Set(existing.map((m) => m.id));
      const merged = [...page.messages.filter((m) => !existingIds.has(m.id)), ...existing];

      return {
        ...prev,
        activeConversation: {
          conversation: page.conversation,
          messages: merged,
        },
      };
    });
    return page;
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

  const forkConversation = useCallback(
    async (conversationId: string, uptoSeq?: number | null) => {
      if (!isTauriContext()) return null;
      const created = await historyForkConversation(conversationId, uptoSeq ?? null);
      await loadConversation(created.id);
      await refreshList();
      return created;
    },
    [loadConversation, refreshList]
  );

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

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      if (!isTauriContext()) return;
      const trimmed = title.trim();
      if (!trimmed) return;

      await historyRenameConversation(conversationId, trimmed);
      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === conversationId ? { ...c, title: trimmed } : c
        ),
        activeConversation:
          prev.activeConversation?.conversation.id === conversationId
            ? {
                ...prev.activeConversation,
                conversation: {
                  ...prev.activeConversation.conversation,
                  title: trimmed,
                },
              }
            : prev.activeConversation,
      }));
      await refreshList();
    },
    [refreshList]
  );

  return {
    ...state,
    refreshList,
    loadConversation,
    loadOlderMessages,
    selectConversation,
    newConversation,
    forkConversation,
    markSeen,
    clearConversation,
    deleteConversation,
    renameConversation,
  };
}
