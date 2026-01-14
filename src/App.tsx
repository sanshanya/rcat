import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MotionConfig } from "framer-motion";
import type { ChatStatus } from "ai";
import { useChat } from "@ai-sdk/react";
import { invoke } from "@tauri-apps/api/core";

import {
  InputView,
  MiniView,
  ResultView,
  SettingsView,
} from "./components/views";
import { Button } from "@/components/ui/button";
import {
  EVT_CLICK_THROUGH_STATE,
  EVT_CAPSULE_OPENED,
  EVT_CHAT_DONE,
  EVT_VRM_STATE_SNAPSHOT,
  getRegisteredModelOptions,
} from "./constants";
import {
  useAiConfig,
  useAutoWindowFit,
  useChatTransport,
  useConversationActions,
  useConversationHistory,
  useGeneratingTracker,
  useModelSelection,
  useRouteController,
  useSkinPreference,
  useSyncWindowModeWithConversation,
  useTauriEvent,
  useToggleExpand,
  useWindowManager,
} from "./hooks";
import { voicePrepare } from "./services";
import { cn } from "@/lib/utils";
import { conversationDetailToUiMessages, reportPromiseError } from "@/utils";
import { ChatProvider } from "@/contexts/ChatContext";
import type { PanelTabId, VrmCommand, VrmStateSnapshot } from "@/windows/vrmBridgeTypes";
import VrmTab from "@/windows/panel/tabs/VrmTab";
import DebugTab from "@/windows/panel/tabs/DebugTab";

type ChatDonePayload = {
  requestId: string;
  conversationId?: string | null;
};

const isChatBusy = (status: ChatStatus) =>
  status === "submitted" || status === "streaming";

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTabId>("chat");
  const [vrmSnapshot, setVrmSnapshot] = useState<VrmStateSnapshot | null>(null);

  // Use custom hooks for cleaner separation of concerns
  const {
    mode: windowMode,
    changeMode,
    reset: resetWindow,
  } = useWindowManager();
  const { activeRoute, isSettingsOpen, openSettings, closeSettings, goMain } =
    useRouteController({ windowMode, changeMode });
  const { config: aiConfig, refresh: refreshAiConfig } = useAiConfig();
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
  const [toolMode, setToolMode] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const { skinMode, setSkinMode } = useSkinPreference();

  useEffect(() => {
    if (!voiceMode) return;
    void voicePrepare().catch(
      reportPromiseError("App.voicePrepare", { onceKey: "App.voicePrepare" })
    );
  }, [voiceMode]);

  const {
    isReady: historyReady,
    conversations,
    activeConversationId,
    activeConversation,
    loadConversation,
    loadOlderMessages,
    selectConversation,
    newConversation,
    forkConversation,
    markSeen,
    deleteConversation,
    renameConversation,
    refreshList,
  } = useConversationHistory();

  // Transport is stable (created once) but reads latest state via internal refs.
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

  const hasHistoryNotification = useMemo(() => {
    const isViewingActiveConversation =
      windowMode !== "mini" && Boolean(activeConversationId);
    return conversations.some((c) => {
      if (!c.hasUnseen) return false;
      if (!isViewingActiveConversation) return true;
      return c.id !== activeConversationId;
    });
  }, [activeConversationId, conversations, windowMode]);

  const shellRef = useRef<HTMLDivElement>(null);
  useAutoWindowFit(shellRef, windowMode, { enabled: true });

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

  const {
    handleEditMessage,
    handleRegenerateFrom,
    handleBranchFrom,
    handleStop,
    handleDeleteConversation,
    handleRenameConversation,
    handleSelectConversation,
  } = useConversationActions({
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
  });

  // Input ref for focus handling + width measurement
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");
  const { collapse, toggleExpand } = useToggleExpand({
    windowMode,
    changeMode,
    resetWindow,
    activeConversationId,
    conversations,
    activeConversation,
    uiMessageCount: messages.length,
    isActiveConversationGenerating,
    markSeen,
    setInputValue,
    goMainRoute: goMain,
    inputRef,
  });

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
        reportPromiseError("App.newConversation", {
          onceKey: "App.newConversation",
        })
      );
  }, [changeMode, newConversation]);

  // Listen for click-through state changes from Rust
  const handleClickThroughChange = useCallback(
    (event: { payload: boolean }) => {
      setIsClickThrough(event.payload);
      if (event.payload) {
        collapse();
      }
    },
    [collapse]
  );

  useTauriEvent<boolean>(EVT_CLICK_THROUGH_STATE, handleClickThroughChange);

  const handleCapsuleOpened = useCallback(
    (event: { payload: { tab?: string } }) => {
      const tab = event.payload?.tab;
      if (tab === "chat" || tab === "vrm" || tab === "debug") {
        setPanelTab(tab);
      }
      if (windowMode === "mini") {
        void changeMode("input").catch(
          reportPromiseError("App.changeMode:capsuleOpened", {
            onceKey: "App.changeMode:capsuleOpened",
          })
        );
      }
    },
    [changeMode, windowMode]
  );

  useTauriEvent(EVT_CAPSULE_OPENED, handleCapsuleOpened);

  const handleVrmStateSnapshot = useCallback((event: { payload: VrmStateSnapshot }) => {
    setVrmSnapshot(event.payload ?? null);
  }, []);

  useTauriEvent<VrmStateSnapshot>(EVT_VRM_STATE_SNAPSHOT, handleVrmStateSnapshot);

  const sendVrmCommand = useCallback((cmd: VrmCommand) => {
    void invoke("vrm_command", { payload: cmd }).catch(
      reportPromiseError("App.vrm_command", {
        onceKey: "App.vrm_command",
      })
    );
  }, []);

  const handleChatDone = useCallback(
    (event: { payload: ChatDonePayload }) => {
      const doneConversationId = event.payload.conversationId ?? null;
      if (doneConversationId) {
        clearGenerating(doneConversationId);
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
        doneConversationId !== null &&
        windowMode !== "mini" &&
        activeConversationId !== null &&
        doneConversationId === activeConversationId;

      if (shouldMarkSeen) {
        void markSeen(doneConversationId).catch(
          reportPromiseError("App.markSeen:chatDone", {
            onceKey: "App.markSeen:chatDone",
          })
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
    [
      activeConversationId,
      clearGenerating,
      loadConversation,
      markSeen,
      refreshList,
      windowMode,
    ]
  );

  useTauriEvent<ChatDonePayload>(EVT_CHAT_DONE, handleChatDone);

  const errorText =
    status === "error" && error ? error.message || String(error) : null;

  const capsuleProps = {
    isThinking: isAnyConversationGenerating,
    modelId: selectedModel,
    provider: aiConfig?.provider ?? null,
    windowMode,
    hasNotification: hasHistoryNotification,
    onClick: toggleExpand,
    disabled: isClickThrough,
  };

  const selectedModelSpec = useMemo(
    () => aiConfig?.models?.find((m) => m.id === selectedModel) ?? null,
    [aiConfig?.models, selectedModel]
  );

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
          reportPromiseError("App.markSeen:voiceSend", {
            onceKey: "App.markSeen:voiceSend",
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
          reportPromiseError("App.markSeen:send", {
            onceKey: "App.markSeen:send",
          })
        );
        markGenerating(activeConversationId);
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
    onRenameConversation: handleRenameConversation,
    isStreaming: status === "streaming",
    isSubmitting: status === "submitted",
    isConversationGenerating: isActiveConversationGenerating,
    disabled: isClickThrough || !historyReady || !isActiveConversationLoaded,
    hasHistoryNotification,
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

  const showChat = messages.length > 0 || isActiveConversationGenerating;

  const chatUiValue = {
    capsuleProps,
    promptProps,
    chatProps,
    showChat,
    modelSpec: selectedModelSpec,
    skinMode,
    errorText,
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
          "relative z-10 flex flex-col items-stretch gap-2 p-0",
          "w-fit",
          windowMode === "result" && "h-full min-h-0"
        )}
      >
        <MotionConfig
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        >
          {isSettingsOpen ? (
            <ChatProvider value={chatUiValue}>
              <SettingsView
                aiConfig={aiConfig}
                onRefreshAiConfig={refreshAiConfig}
                onClose={closeSettings}
                skinMode={skinMode}
                onSkinModeChange={setSkinMode}
              />
            </ChatProvider>
          ) : windowMode === "mini" ? (
            <ChatProvider value={chatUiValue}>
              <MiniView />
            </ChatProvider>
          ) : (
            <div
              className={cn(
                "flex min-w-0 items-stretch gap-3",
                windowMode === "result" && "flex-1 min-h-0"
              )}
            >
              <div className="flex min-w-0 flex-col items-stretch gap-2">
                <div className="flex items-center gap-1 rounded-md bg-background/60 p-1 backdrop-blur">
                  <Button
                    size="sm"
                    variant={panelTab === "chat" ? "default" : "secondary"}
                    onClick={() => setPanelTab("chat")}
                  >
                    Chat
                  </Button>
                  <Button
                    size="sm"
                    variant={panelTab === "vrm" ? "default" : "secondary"}
                    onClick={() => setPanelTab("vrm")}
                  >
                    VRM
                  </Button>
                  <Button
                    size="sm"
                    variant={panelTab === "debug" ? "default" : "secondary"}
                    onClick={() => setPanelTab("debug")}
                  >
                    Debug
                  </Button>
                </div>

                {panelTab === "chat" ? (
                  <ChatProvider value={chatUiValue}>
                    {windowMode === "input" ? (
                      <InputView className={undefined} />
                    ) : (
                      <ResultView className={undefined} />
                    )}
                  </ChatProvider>
                ) : panelTab === "vrm" ? (
                  <VrmTab snapshot={vrmSnapshot} sendCommand={sendVrmCommand} />
                ) : (
                  <DebugTab snapshot={vrmSnapshot} sendCommand={sendVrmCommand} />
                )}
              </div>
            </div>
          )}
        </MotionConfig>
      </div>
    </div>
  );
}

export default App;
