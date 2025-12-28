import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { MotionConfig } from "framer-motion";
import { useChat } from "@ai-sdk/react";

import { Capsule } from "./components";
import ChatMessages from "./components/ChatMessages";
import PromptInput from "./components/PromptInput";
import {
  EVT_CLICK_THROUGH_STATE,
  DEFAULT_RESULT_SIZE,
  getRegisteredModelOptions,
} from "./constants";
import { useAiPublicConfig, useAutoWindowFit, useWindowManager, useTauriEvent } from "./hooks";
import { createTauriChatTransport } from "./services";
import { cn } from "@/lib/utils";
import { reportPromiseError } from "@/utils";

const createChatSessionId = () =>
  `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);

  // Use custom hooks for cleaner separation of concerns
  const {
    mode: windowMode,
    changeMode,
    reset: resetWindow,
  } = useWindowManager();
  const aiConfig = useAiPublicConfig();
  const modelOptions = useMemo(
    () => getRegisteredModelOptions(aiConfig?.provider, aiConfig?.model),
    [aiConfig?.provider, aiConfig?.model]
  );
  const [selectedModel, setSelectedModel] = useState(
    () => modelOptions[0]?.id ?? "deepseek-reasoner"
  );
  const didInitModelFromBackendRef = useRef(false);
  const selectedModelRef = useRef(selectedModel);
  const [toolMode, setToolMode] = useState(false);
  const toolModeRef = useRef(toolMode);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    // Initialize model from backend config once it is available, and keep the
    // selected value valid when provider/options change.
    const configured = aiConfig?.model?.trim();
    if (!aiConfig) return;

    if (!didInitModelFromBackendRef.current) {
      didInitModelFromBackendRef.current = true;
      if (configured && modelOptions.some((m) => m.id === configured)) {
        setSelectedModel(configured);
        return;
      }
      if (modelOptions.length > 0) {
        setSelectedModel(modelOptions[0].id);
      }
      return;
    }

    const allowed = modelOptions.some((m) => m.id === selectedModel);
    if (allowed) return;

    if (configured && modelOptions.some((m) => m.id === configured)) {
      setSelectedModel(configured);
      return;
    }
    if (modelOptions.length > 0) {
      setSelectedModel(modelOptions[0].id);
    }
  }, [aiConfig?.model, modelOptions, selectedModel]);

  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  const transport = useMemo(
    // eslint-disable-next-line
    () => createTauriChatTransport({
      getModel: () => selectedModelRef.current,
      getToolMode: () => toolModeRef.current,
    }),
    []
  );
  const [chatSessionId, setChatSessionId] = useState(createChatSessionId);
  const { messages, status, sendMessage, error, setMessages, stop } = useChat({
    id: chatSessionId,
    transport,
  });
  const isBusy = status === "submitted" || status === "streaming";
  const shellRef = useRef<HTMLDivElement>(null);
  useAutoWindowFit(shellRef, windowMode);

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
    [messages, setMessages, sendMessage]
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

      // Get user message text
      const userText = userMessageBefore.parts
        .filter(
          (part): part is { type: "text"; text: string } => part.type === "text"
        )
        .map((part) => part.text)
        .join("\n");

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
    [messages, setMessages, sendMessage]
  );

  // Input ref for focus handling + width measurement
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");

  const handleReset = useCallback(() => {
    setChatSessionId(createChatSessionId());
    setInputValue("");
    resetWindow();
  }, [resetWindow]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setInputValue("");
  }, [setMessages]);

  // Listen for click-through state changes from Rust
  const handleClickThroughChange = useCallback(
    (event: { payload: boolean }) => {
      setIsClickThrough(event.payload);
      if (event.payload) {
        handleReset();
      }
    },
    [handleReset]
  );

  useTauriEvent<boolean>(EVT_CLICK_THROUGH_STATE, handleClickThroughChange);

  const toggleExpand = async () => {
    if (windowMode !== "mini") {
      handleReset();
    } else {
      await changeMode("input");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
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
          <Capsule
            isThinking={isBusy}
            messageCount={messages.length}
            modelId={selectedModel}
            windowMode={windowMode}
            onClick={toggleExpand}
            disabled={isClickThrough}
          />

          {windowMode !== "mini" && (
            <PromptInput
              ref={inputRef}
              value={inputValue}
              onChange={setInputValue}
              onSubmit={async () => {
                const textToSend = inputValue.trim();
                if (!textToSend) return;

                setInputValue("");
                sendMessage({ text: textToSend });

                if (windowMode === "input") {
                  void changeMode("result", {
                    w: window.innerWidth,
                    h: DEFAULT_RESULT_SIZE.h,
                  }).catch(
                    reportPromiseError("App.changeMode", { onceKey: "App.changeMode" })
                  );
                }
              }}
              onStop={stop}
              onClearChat={handleClearChat}
              isStreaming={status === "streaming"}
              isSubmitting={status === "submitted"}
              disabled={isClickThrough}
              model={selectedModel}
              modelOptions={modelOptions}
              onModelChange={setSelectedModel}
              toolMode={toolMode}
              onToolModeChange={setToolMode}
            />
          )}

          {messages.length > 0 && (
            <ChatMessages
              messages={messages}
              status={status}
              onRegenerate={handleRegenerateFrom}
              onEditMessage={handleEditMessage}
            />
          )}

          {status === "error" && error && (
            <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
              {error.message || String(error)}
            </div>
          )}
        </MotionConfig>
      </div>
    </div>
  );
}

export default App;
