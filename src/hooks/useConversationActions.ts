import { useCallback } from "react";
import type { UIMessage } from "ai";

import type { WindowMode } from "@/types";
import { chatAbortConversation, voiceStop } from "@/services";
import { getMessageText, reportPromiseError } from "@/utils";

type UseConversationActionsParams = {
  activeConversationId: string | null;
  windowMode: WindowMode;
  messages: UIMessage[];
  sendMessage: (payload: { text: string }) => void;
  setMessages: (messages: UIMessage[]) => void;
  stop: () => void;
  busy: boolean;
  isConversationGenerating: (conversationId: string) => boolean;
  clearGenerating: (conversationId: string) => void;
  forkConversation: (
    conversationId: string,
    uptoSeq?: number | null
  ) => Promise<unknown>;
  deleteConversation: (conversationId: string) => Promise<unknown>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  markSeen: (conversationId: string) => Promise<void>;
};

export function useConversationActions({
  activeConversationId,
  windowMode,
  messages,
  sendMessage,
  setMessages,
  stop,
  busy,
  isConversationGenerating,
  clearGenerating,
  forkConversation,
  deleteConversation,
  renameConversation,
  selectConversation,
  markSeen,
}: UseConversationActionsParams) {
  const parseHistorySeq = useCallback(
    (messageId: string) => {
      if (!activeConversationId) return null;
      const [prefix, seqStr, ...rest] = messageId.split(":");
      if (rest.length > 0) return null;
      if (prefix !== activeConversationId) return null;
      const seq = Number(seqStr);
      if (!Number.isFinite(seq) || seq <= 0) return null;
      return Math.floor(seq);
    },
    [activeConversationId]
  );

  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      // Find the message index
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      // Truncate messages after this point and update the edited message
      const truncatedMessages = messages.slice(0, messageIndex);
      setMessages(truncatedMessages);

      // Send the new message
      sendMessage({ text: newText });
    },
    [activeConversationId, messages, sendMessage, setMessages]
  );

  const handleRegenerateFrom = useCallback(
    (messageId: string) => {
      // Find the assistant message index
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      // Find the user message before this assistant message
      const userMessageBefore = messages
        .slice(0, messageIndex)
        .reverse()
        .find((m) => m.role === "user");

      if (!userMessageBefore) return;

      const userText = getMessageText(userMessageBefore);

      // Find the user message index
      const userMessageIndex = messages.findIndex(
        (m) => m.id === userMessageBefore.id
      );

      // Truncate messages from the user message onwards
      const truncatedMessages = messages.slice(0, userMessageIndex);
      setMessages(truncatedMessages);

      // Resend the user message
      sendMessage({ text: userText });
    },
    [activeConversationId, messages, sendMessage, setMessages]
  );

  const handleBranchFrom = useCallback(
    async (messageId: string) => {
      if (!activeConversationId) return;

      const uptoSeq = parseHistorySeq(messageId);
      if (!uptoSeq) return;

      try {
        await forkConversation(activeConversationId, uptoSeq);
      } catch (error) {
        reportPromiseError("App.forkConversation", {
          onceKey: "App.forkConversation",
        })(error);
        throw error;
      }
    },
    [activeConversationId, forkConversation, parseHistorySeq]
  );

  const handleStop = useCallback(() => {
    const conversationId = activeConversationId;
    if (!conversationId) {
      void voiceStop().catch(
        reportPromiseError("App.voiceStop", { onceKey: "App.voiceStop" })
      );
      stop();
      return;
    }

    const isGenerating = isConversationGenerating(conversationId) || busy;
    if (!isGenerating) return;

    // Optimistically clear local generating state (backend completion/abort will reconcile too).
    clearGenerating(conversationId);

    void voiceStop().catch(
      reportPromiseError("App.voiceStop", { onceKey: "App.voiceStop" })
    );

    if (!busy) {
      void chatAbortConversation(conversationId).catch(
        reportPromiseError("App.chatAbortConversation", {
          onceKey: "App.chatAbortConversation",
        })
      );
      return;
    }

    stop();
  }, [
    activeConversationId,
    busy,
    clearGenerating,
    isConversationGenerating,
    stop,
  ]);

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      void (async () => {
        const isDeletingActive = conversationId === activeConversationId;

        if (isDeletingActive) {
          handleStop();
        } else {
          void chatAbortConversation(conversationId).catch(
            reportPromiseError("App.chatAbortConversation:delete", {
              onceKey: "App.chatAbortConversation:delete",
              devOnly: true,
            })
          );
        }

        clearGenerating(conversationId);

        await deleteConversation(conversationId);
      })().catch(
        reportPromiseError("App.deleteConversation", {
          onceKey: "App.deleteConversation",
        })
      );
    },
    [activeConversationId, clearGenerating, deleteConversation, handleStop]
  );

  const handleRenameConversation = useCallback(
    async (conversationId: string, title: string) => {
      try {
        await renameConversation(conversationId, title);
      } catch (error) {
        reportPromiseError("App.renameConversation", {
          onceKey: "App.renameConversation",
        })(error);
        throw error;
      }
    },
    [renameConversation]
  );

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      void (async () => {
        if (!conversationId) return;
        if (conversationId === activeConversationId) return;

        // The user is leaving the current conversation view: mark it as seen to
        // avoid showing a "new" badge for a conversation they just read.
        if (activeConversationId && windowMode !== "mini") {
          await markSeen(activeConversationId);
        }

        await selectConversation(conversationId);
        await markSeen(conversationId);
      })().catch(
        reportPromiseError("App.selectConversation", {
          onceKey: "App.selectConversation",
        })
      );
    },
    [activeConversationId, markSeen, selectConversation, windowMode]
  );

  return {
    handleEditMessage,
    handleRegenerateFrom,
    handleBranchFrom,
    handleStop,
    handleDeleteConversation,
    handleRenameConversation,
    handleSelectConversation,
  };
}
