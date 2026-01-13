import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStatus } from "ai";
import { useChat } from "@ai-sdk/react";

import ChatMessages from "@/components/ChatMessages";
import PromptInput from "@/components/PromptInput";
import { EVT_CHAT_DONE, EVT_CONTEXT_PANEL_OPENED, getRegisteredModelOptions } from "@/constants";
import {
  useAiConfig,
  useChatTransport,
  useConversationActions,
  useConversationHistory,
  useGeneratingTracker,
  useModelSelection,
  useSkinPreference,
  useTauriEvent,
} from "@/hooks";
import { hideContextPanel, voicePrepare } from "@/services";
import { cn } from "@/lib/utils";
import { conversationDetailToUiMessages, reportPromiseError } from "@/utils";

type ChatDonePayload = {
  requestId: string;
  conversationId?: string | null;
};

const isChatBusy = (status: ChatStatus) =>
  status === "submitted" || status === "streaming";

export default function ContextPanelApp() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [toolMode, setToolMode] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const { skinMode, setSkinMode } = useSkinPreference();

  useEffect(() => {
    if (!voiceMode) return;
    void voicePrepare().catch(
      reportPromiseError("ContextPanel.voicePrepare", {
        onceKey: "ContextPanel.voicePrepare",
      })
    );
  }, [voiceMode]);

  const focusInput = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void hideContextPanel().catch(
        reportPromiseError("ContextPanel.hideContextPanel:escape", {
          onceKey: "ContextPanel.hideContextPanel:escape",
        })
      );
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useTauriEvent(EVT_CONTEXT_PANEL_OPENED, () => {
    focusInput();
  });

  const {
    isReady: historyReady,
    conversations,
    activeConversationId,
    activeConversation,
    loadOlderMessages,
    selectConversation,
    newConversation,
    forkConversation,
    markSeen,
    deleteConversation,
    renameConversation,
    refreshList,
  } = useConversationHistory();

  const { config: aiConfig } = useAiConfig();
  const modelOptions = useMemo(
    () =>
      getRegisteredModelOptions(
        aiConfig?.provider,
        aiConfig?.model,
        aiConfig?.models
      ),
    [aiConfig?.model, aiConfig?.models, aiConfig?.provider]
  );
  const { selectedModel, setSelectedModel } = useModelSelection(aiConfig, modelOptions);

  const transport = useChatTransport({
    model: selectedModel,
    toolMode,
    voiceMode,
    conversationId: activeConversationId ?? undefined,
  });
  const { messages, status, sendMessage, error, setMessages, stop } = useChat({
    id: activeConversationId ?? "loading",
    transport,
  });

  const busy = isChatBusy(status);
  const {
    isConversationGenerating,
    isActiveConversationGenerating,
    isActiveConversationDetachedGenerating,
    isAnyConversationGenerating,
    markGenerating,
    clearGenerating,
  } = useGeneratingTracker({ activeConversationId, busy, status });

  useEffect(() => {
    if (!activeConversation) return;
    setMessages(conversationDetailToUiMessages(activeConversation));
  }, [activeConversation, setMessages]);

  const handleChatDone = useCallback(
    (event: { payload: ChatDonePayload }) => {
      const doneConversationId = event.payload.conversationId ?? null;
      if (doneConversationId) {
        clearGenerating(doneConversationId);
      }

      void refreshList().catch(
        reportPromiseError("ContextPanel.refreshHistory:chatDone", {
          onceKey: "ContextPanel.refreshHistory:chatDone",
        })
      );
    },
    [clearGenerating, refreshList]
  );

  useTauriEvent<ChatDonePayload>(EVT_CHAT_DONE, handleChatDone);

  const handleStop = useCallback(() => {
    const conversationId = activeConversationId;
    if (conversationId) {
      clearGenerating(conversationId);
    }
    stop();
  }, [activeConversationId, clearGenerating, stop]);

  const {
    handleEditMessage,
    handleRegenerateFrom,
    handleBranchFrom,
    handleDeleteConversation,
    handleRenameConversation,
    handleSelectConversation,
  } = useConversationActions({
    activeConversationId,
    windowMode: "result",
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
  });

  const handleNewConversation = useCallback(() => {
    void newConversation()
      .then(() => {
        setInputValue("");
        window.setTimeout(() => inputRef.current?.focus(), 50);
      })
      .catch(
        reportPromiseError("ContextPanel.newConversation", {
          onceKey: "ContextPanel.newConversation",
        })
      );
  }, [newConversation]);

  const errorText =
    status === "error" && error ? error.message || String(error) : null;

  const isActiveConversationLoaded = Boolean(
    activeConversationId &&
      activeConversation?.conversation?.id === activeConversationId
  );

  const promptProps = {
    ref: inputRef,
    value: inputValue,
    onChange: setInputValue,
    onVoiceSubmit: async (text: string) => {
      const textToSend = text.trim();
      if (!textToSend) return;

      handleStop();
      setInputValue("");

      if (activeConversationId) {
        void markSeen(activeConversationId).catch(
          reportPromiseError("ContextPanel.markSeen:voiceSend", {
            onceKey: "ContextPanel.markSeen:voiceSend",
          })
        );
        markGenerating(activeConversationId);
      }
      sendMessage({ text: textToSend });
    },
    onSubmit: async () => {
      const textToSend = inputValue.trim();
      if (!textToSend) return;

      setInputValue("");
      if (activeConversationId) {
        void markSeen(activeConversationId).catch(
          reportPromiseError("ContextPanel.markSeen:send", {
            onceKey: "ContextPanel.markSeen:send",
          })
        );
        markGenerating(activeConversationId);
      }
      sendMessage({ text: textToSend });
    },
    onStop: handleStop,
    conversations,
    activeConversationId,
    onSelectConversation: handleSelectConversation,
    onNewConversation: handleNewConversation,
    onDeleteConversation: handleDeleteConversation,
    onRenameConversation: handleRenameConversation,
    isStreaming: status === "streaming",
    isSubmitting: status === "submitted",
    isConversationGenerating: isActiveConversationGenerating,
    disabled: !historyReady || !isActiveConversationLoaded,
    model: selectedModel,
    modelOptions,
    onModelChange: setSelectedModel,
    toolMode,
    onToolModeChange: setToolMode,
    voiceMode,
    onVoiceModeChange: setVoiceMode,
  };

  const hasMoreHistory = (activeConversation?.messages?.[0]?.seq ?? 1) > 1;
  const chatProps = {
    conversationId: activeConversationId,
    isBackgroundGenerating: isActiveConversationDetachedGenerating,
    messages,
    status: (busy ? status : "ready") as ChatStatus,
    hasMoreHistory,
    onLoadMoreHistory: activeConversationId
      ? () => loadOlderMessages(activeConversationId)
      : undefined,
    onRegenerate: handleRegenerateFrom,
    onBranch: activeConversationId ? handleBranchFrom : undefined,
    onEditMessage: handleEditMessage,
  };

  const showChat = messages.length > 0 || isAnyConversationGenerating;

  return (
    <div className="h-full w-full bg-transparent p-3">
      <div
        className={cn(
          "flex h-full min-h-0 flex-col gap-2 rounded-2xl border border-border/50 bg-background/80 p-3 shadow-xl backdrop-blur",
          "ring-1 ring-inset ring-white/10"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground/90">Chat</div>
          <div className="flex items-center gap-2">
            {skinMode === "vrm" ? (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
                onClick={() => {
                  setSkinMode("off");
                  void hideContextPanel().catch(
                    reportPromiseError("ContextPanel.hideContextPanel:exitVrm", {
                      onceKey: "ContextPanel.hideContextPanel:exitVrm",
                    })
                  );
                }}
                title="退出 VRM"
              >
                Classic
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground"
              onClick={() => {
                void hideContextPanel().catch(
                  reportPromiseError("ContextPanel.hideContextPanel:button", {
                    onceKey: "ContextPanel.hideContextPanel:button",
                  })
                );
              }}
              title="关闭"
            >
              关闭
            </button>
          </div>
        </div>

        <PromptInput {...promptProps} />
        {showChat ? <ChatMessages {...chatProps} /> : null}
        {errorText ? (
          <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
            {errorText}
          </div>
        ) : null}
      </div>
    </div>
  );
}
