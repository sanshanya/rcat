import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { MotionConfig } from "framer-motion";
import type { ChatStatus } from "ai";
import { useChat } from "@ai-sdk/react";

import type { WindowMode } from "@/types";
import { InputView, MiniView, ResultView, SettingsView } from "./components/views";
import {
  EVT_CLICK_THROUGH_STATE,
  EVT_CHAT_DONE,
  getRegisteredModelOptions,
} from "./constants";
import {
  useAiConfig,
  useAutoWindowFit,
  useConversationHistory,
  useModelSelection,
  useSyncWindowModeWithConversation,
  useTauriEvent,
  useWindowManager,
} from "./hooks";
import { chatAbortConversation, createTauriChatTransport } from "./services";
import { cn } from "@/lib/utils";
import { conversationDetailToUiMessages, getMessageText, reportPromiseError } from "@/utils";

type ChatDonePayload = {
  requestId: string;
  conversationId?: string | null;
};

const isChatBusy = (status: ChatStatus) => status === "submitted" || status === "streaming";

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [activeRoute, setActiveRoute] = useState<"main" | "settings">("main");

  // Use custom hooks for cleaner separation of concerns
  const {
    mode: windowMode,
    changeMode,
    reset: resetWindow,
  } = useWindowManager();
  const { config: aiConfig, refresh: refreshAiConfig } = useAiConfig();
  const modelOptions = useMemo(
    () => getRegisteredModelOptions(aiConfig?.provider, aiConfig?.model, aiConfig?.models),
    [aiConfig?.model, aiConfig?.models, aiConfig?.provider]
  );
  const { selectedModel, setSelectedModel, selectedModelRef } = useModelSelection(
    aiConfig,
    modelOptions
  );
  const [toolMode, setToolMode] = useState(false);
  const toolModeRef = useRef(toolMode);

  // Keep refs in sync immediately for event handlers/transport (avoid 1-render lag).
  toolModeRef.current = toolMode;

  const {
    isReady: historyReady,
    conversations,
    activeConversationId,
    activeConversation,
    loadConversation,
    selectConversation,
    newConversation,
    markSeen,
    deleteConversation,
    refreshList,
  } = useConversationHistory();

  const [generatingConversations, setGeneratingConversations] = useState<Set<string>>(
    () => new Set()
  );
  const attachedConversationIdRef = useRef<string | null>(null);
  const requestConversationIdMapRef = useRef<Map<string, string>>(new Map());

  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  const transport = useMemo(
    // eslint-disable-next-line
    () => createTauriChatTransport({
      getModel: () => selectedModelRef.current,
      getToolMode: () => toolModeRef.current,
      getConversationId: () => activeConversationIdRef.current ?? undefined,
      onRequestCreated: ({ requestId, conversationId }) => {
        if (!conversationId) return;
        requestConversationIdMapRef.current.set(requestId, conversationId);
      },
    }),
    []
  );
  const { messages, status, sendMessage, error, setMessages, stop } = useChat({
    id: activeConversationId ?? "loading",
    transport,
  });

  const busy = isChatBusy(status);

  const isActiveConversationGenerating = activeConversationId
    ? generatingConversations.has(activeConversationId)
    : false;
  const isActiveConversationDetachedGenerating = isActiveConversationGenerating && !busy;
  const isAnyConversationGenerating = busy || generatingConversations.size > 0;

  const hasHistoryNotification = useMemo(() => {
    const isViewingActiveConversation = windowMode !== "mini" && Boolean(activeConversationId);
    return conversations.some((c) => {
      if (!c.hasUnseen) return false;
      if (!isViewingActiveConversation) return true;
      return c.id !== activeConversationId;
    });
  }, [activeConversationId, conversations, windowMode]);
  const shellRef = useRef<HTMLDivElement>(null);
  useAutoWindowFit(shellRef, windowMode);

  useSyncWindowModeWithConversation({
    windowMode,
    activeConversationId,
    conversations,
    activeConversation,
    messageCount: messages.length,
    isActiveConversationGenerating,
    changeMode,
    enabled: activeRoute === "main",
  });

  useEffect(() => {
    if (!activeConversation) return;
    setMessages(conversationDetailToUiMessages(activeConversation));
  }, [activeConversation, setMessages]);

  // Handle editing a user message and resending
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
    [activeConversationId, messages, setMessages, sendMessage]
  );

  // Handle regenerating from a specific assistant message
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
    [activeConversationId, messages, setMessages, sendMessage]
  );

  // Input ref for focus handling + width measurement
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");
  const settingsReturnModeRef = useRef<WindowMode>("input");
  const isSettingsOpen = activeRoute === "settings";

  const openSettings = useCallback(() => {
    // Keep the UX stable: open settings in result mode (fixed-ish window with internal scroll).
    settingsReturnModeRef.current = windowMode === "mini" ? "input" : windowMode;
    setActiveRoute("settings");
    void changeMode("result").catch(
      reportPromiseError("App.changeMode:openSettings", {
        onceKey: "App.changeMode:openSettings",
      })
    );
  }, [changeMode, windowMode]);

  const closeSettings = useCallback(() => {
    setActiveRoute("main");
    const target = settingsReturnModeRef.current;
    if (target !== windowMode) {
      void changeMode(target).catch(
        reportPromiseError("App.changeMode:closeSettings", {
          onceKey: "App.changeMode:closeSettings",
        })
      );
    }
  }, [changeMode, windowMode]);

  const handleCollapse = useCallback(() => {
    setInputValue("");
    setActiveRoute("main");
    resetWindow();
  }, [resetWindow]);

  const handleNewConversation = useCallback(() => {
    void newConversation()
      .then(() => {
        setInputValue("");
        void changeMode("input").catch(
          reportPromiseError("App.changeMode:newConversation", {
            onceKey: "App.changeMode:newConversation",
          })
        );
        setTimeout(() => inputRef.current?.focus(), 100);
      })
      .catch(
        reportPromiseError("App.newConversation", { onceKey: "App.newConversation" })
      );
  }, [changeMode, newConversation]);

  const handleStop = useCallback(() => {
    const conversationId = activeConversationId;
    if (!conversationId) {
      stop();
      return;
    }

    const isGenerating = generatingConversations.has(conversationId) || busy;
    if (!isGenerating) return;

    // Optimistically clear local generating state (backend completion/abort will reconcile too).
    setGeneratingConversations((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });

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
    generatingConversations,
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

        setGeneratingConversations((prev) => {
          if (!prev.has(conversationId)) return prev;
          const next = new Set(prev);
          next.delete(conversationId);
          return next;
        });

        await deleteConversation(conversationId);
      })().catch(
        reportPromiseError("App.deleteConversation", {
          onceKey: "App.deleteConversation",
        })
      );
    },
    [activeConversationId, deleteConversation, handleStop]
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

  // Listen for click-through state changes from Rust
  const handleClickThroughChange = useCallback(
    (event: { payload: boolean }) => {
      setIsClickThrough(event.payload);
      if (event.payload) {
        handleCollapse();
      }
    },
    [handleCollapse]
  );

  useTauriEvent<boolean>(EVT_CLICK_THROUGH_STATE, handleClickThroughChange);

  const handleChatDone = useCallback(
    (event: { payload: ChatDonePayload }) => {
      const requestId = event.payload.requestId;
      const mappedConversationId =
        requestConversationIdMapRef.current.get(requestId) ?? null;
      requestConversationIdMapRef.current.delete(requestId);

      const doneConversationId = event.payload.conversationId ?? mappedConversationId;
      if (doneConversationId) {
        setGeneratingConversations((prev) => {
          if (!prev.has(doneConversationId)) return prev;
          const next = new Set(prev);
          next.delete(doneConversationId);
          return next;
        });
      }

      if (!doneConversationId) {
        void refreshList().catch(
          reportPromiseError("App.refreshHistory:chatDone", {
            onceKey: "App.refreshHistory:chatDone",
          })
        );
        return;
      }

      const shouldMarkSeen =
        doneConversationId !== null
        && windowMode !== "mini"
        && activeConversationId !== null
        && doneConversationId === activeConversationId;

      if (shouldMarkSeen) {
        void markSeen(doneConversationId).catch(
          reportPromiseError("App.markSeen:chatDone", { onceKey: "App.markSeen:chatDone" })
        );

        // If the user switched away mid-stream and returned, the UI is no longer attached
        // to the original stream. Reload persisted messages on completion so the final
        // assistant output appears without requiring another conversation switch.
        void loadConversation(doneConversationId).catch(
          reportPromiseError("App.loadConversation:chatDone", {
            onceKey: "App.loadConversation:chatDone",
          })
        );
        return;
      }

      void refreshList().catch(
        reportPromiseError("App.refreshHistory:chatDone", {
          onceKey: "App.refreshHistory:chatDone",
        })
      );
    },
    [activeConversationId, loadConversation, markSeen, refreshList, windowMode]
  );

  useTauriEvent<ChatDonePayload>(EVT_CHAT_DONE, handleChatDone);

  const toggleExpand = async () => {
    if (windowMode !== "mini") {
      if (activeConversationId) {
        void markSeen(activeConversationId).catch(
          reportPromiseError("App.markSeen:collapse", { onceKey: "App.markSeen:collapse" })
        );
      }
      handleCollapse();
      return;
    }

    const listCount =
      conversations.find((c) => c.id === activeConversationId)?.messageCount ?? 0;
    const persistedCount =
      activeConversation?.conversation?.id === activeConversationId
        ? activeConversation.messages.length
        : 0;
    const hasConversationMessages =
      messages.length > 0 || listCount > 0 || persistedCount > 0;
    const nextMode =
      hasConversationMessages || isActiveConversationGenerating ? "result" : "input";
    await changeMode(nextMode);

    if (activeConversationId) {
      void markSeen(activeConversationId).catch(
        reportPromiseError("App.markSeen:expand", { onceKey: "App.markSeen:expand" })
      );
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  useEffect(() => {
    if (status !== "error") return;
    if (!activeConversationId) return;
    setGeneratingConversations((prev) => {
      if (!prev.has(activeConversationId)) return prev;
      const next = new Set(prev);
      next.delete(activeConversationId);
      return next;
    });
  }, [activeConversationId, status]);

  useEffect(() => {
    if (!activeConversationId) return;
    if (busy) {
      attachedConversationIdRef.current = activeConversationId;
      return;
    }

    const attachedId = attachedConversationIdRef.current;
    if (!attachedId) return;
    if (attachedId !== activeConversationId) {
      attachedConversationIdRef.current = null;
      return;
    }

    // Stream finished while the user is still viewing this conversation. Clear the local
    // generating marker immediately to avoid "已完成但仍显示正在生成" flicker.
    setGeneratingConversations((prev) => {
      if (!prev.has(attachedId)) return prev;
      const next = new Set(prev);
      next.delete(attachedId);
      return next;
    });
    attachedConversationIdRef.current = null;
  }, [activeConversationId, busy]);

  const errorText =
    status === "error" && error ? error.message || String(error) : null;

  const capsuleProps = {
    isThinking: isAnyConversationGenerating,
    modelId: selectedModel,
    windowMode,
    hasNotification: hasHistoryNotification,
    onClick: toggleExpand,
    disabled: isClickThrough,
  };

  const selectedModelSpec = useMemo(
    () => aiConfig?.models?.find((m) => m.id === selectedModel) ?? null,
    [aiConfig?.models, selectedModel]
  );

  const promptProps = {
    ref: inputRef,
    value: inputValue,
    onChange: setInputValue,
    onSubmit: async () => {
      const textToSend = inputValue.trim();
      if (!textToSend) return;

      setInputValue("");
      if (activeConversationId) {
        void markSeen(activeConversationId).catch(
          reportPromiseError("App.markSeen:send", { onceKey: "App.markSeen:send" })
        );

        setGeneratingConversations((prev) => {
          if (prev.has(activeConversationId)) return prev;
          const next = new Set(prev);
          next.add(activeConversationId);
          return next;
        });
      }
      sendMessage({ text: textToSend });
    },
    onStop: handleStop,
    onOpenSettings: openSettings,
    conversations,
    activeConversationId,
    onSelectConversation: handleSelectConversation,
    onNewConversation: handleNewConversation,
    onDeleteConversation: handleDeleteConversation,
    isStreaming: status === "streaming",
    isSubmitting: status === "submitted",
    isConversationGenerating: isActiveConversationGenerating,
    disabled: isClickThrough || !historyReady || !activeConversationId,
    hasHistoryNotification,
    model: selectedModel,
    modelOptions,
    onModelChange: setSelectedModel,
    toolMode,
    onToolModeChange: setToolMode,
  };

  const chatProps = {
    conversationId: activeConversationId,
    isBackgroundGenerating: isActiveConversationDetachedGenerating,
    messages,
    status: (busy ? status : "ready") as ChatStatus,
    onRegenerate: handleRegenerateFrom,
    onEditMessage: handleEditMessage,
  };

  return (
    <div
      className={cn(
        "group relative h-full w-full bg-transparent text-foreground",
        isClickThrough && "opacity-60 grayscale"
      )}
    >
      <div
        ref={shellRef}
        className={cn(
          "flex flex-col items-stretch gap-2 p-0",
          windowMode === "mini" ? "w-fit" : "w-full",
          windowMode === "result" && "h-full min-h-0"
        )}
      >
        <MotionConfig
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        >
          {isSettingsOpen ? (
            <SettingsView
              capsuleProps={capsuleProps}
              aiConfig={aiConfig}
              onRefreshAiConfig={refreshAiConfig}
              onClose={closeSettings}
            />
          ) : windowMode === "mini" ? (
            <MiniView capsuleProps={capsuleProps} />
          ) : windowMode === "input" ? (
            <InputView
              capsuleProps={capsuleProps}
              promptProps={promptProps}
              errorText={errorText}
            />
          ) : (
            <ResultView
              capsuleProps={capsuleProps}
              promptProps={promptProps}
              chatProps={chatProps}
              showChat={messages.length > 0 || isActiveConversationGenerating}
              modelSpec={selectedModelSpec}
              errorText={errorText}
            />
          )}
        </MotionConfig>
      </div>
    </div>
  );
}

export default App;
