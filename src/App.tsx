import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type PointerEvent,
} from "react";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MotionConfig } from "framer-motion";
import { useChat } from "@ai-sdk/react";

import { Capsule, ResizeHandle } from "./components";
import ChatMessages from "./components/ChatMessages";
import PromptInput from "./components/PromptInput";
import { EVT_CLICK_THROUGH_STATE, AUTO_RESIZE_MAX_WIDTH, INPUT_PADDING } from "./constants";
import { useWindowManager, useTauriEvent } from "./hooks";
import { measureTextWidth } from "./utils";
import { createTauriChatTransport } from "./services";

const appWindow = getCurrentWindow();
const createChatSessionId = () =>
  `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);

  // Use custom hooks for cleaner separation of concerns
  const windowManager = useWindowManager();
  const transport = useMemo(() => createTauriChatTransport(), []);
  const [chatSessionId, setChatSessionId] = useState(createChatSessionId);
  const { messages, status, sendMessage, error, setMessages, stop } = useChat({
    id: chatSessionId,
    transport,
  });
  const isBusy = status === "submitted" || status === "streaming";

  // Handle editing a user message and resending
  const handleEditMessage = useCallback((messageId: string, newText: string) => {
    // Find the message index
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    // Truncate messages after this point and update the edited message
    const truncatedMessages = messages.slice(0, messageIndex);
    setMessages(truncatedMessages);

    // Send the new message
    sendMessage({ text: newText });
  }, [messages, setMessages, sendMessage]);

  // Handle regenerating from a specific assistant message
  const handleRegenerateFrom = useCallback((messageId: string) => {
    // Find the assistant message index
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    // Find the user message before this assistant message
    const userMessageBefore = messages
      .slice(0, messageIndex)
      .reverse()
      .find(m => m.role === "user");

    if (!userMessageBefore) return;

    // Get user message text
    const userText = userMessageBefore.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map(part => part.text)
      .join("\n");

    // Find the user message index
    const userMessageIndex = messages.findIndex(m => m.id === userMessageBefore.id);

    // Truncate messages from the user message onwards
    const truncatedMessages = messages.slice(0, userMessageIndex);
    setMessages(truncatedMessages);

    // Resend the user message
    sendMessage({ text: userText });
  }, [messages, setMessages, sendMessage]);

  // Input ref for focus handling
  const inputRef = useRef<HTMLInputElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState("deepseek-reasoner");

  const handleReset = useCallback(() => {
    setChatSessionId(createChatSessionId());
    setInputValue("");
    windowManager.reset();
  }, [windowManager]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setInputValue("");
  }, [setMessages]);

  // Listen for click-through state changes from Rust
  const handleClickThroughChange = useCallback((event: { payload: boolean }) => {
    setIsClickThrough(event.payload);
    if (event.payload) {
      handleReset();
    }
  }, [handleReset]);

  useTauriEvent<boolean>(EVT_CLICK_THROUGH_STATE, handleClickThroughChange);

  // Auto-resize input width based on text content
  const resizeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (windowManager.mode !== 'input') return;
    if (windowManager.inputWidth !== null) return; // Skip if manual override

    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = window.setTimeout(() => {
      const textWidth = measureTextWidth(inputValue, inputRef.current);
      const desiredWidth = Math.min(textWidth + INPUT_PADDING, AUTO_RESIZE_MAX_WIDTH);
      windowManager.requestAutoResize(desiredWidth);
    }, 50);

    return () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    };
  }, [inputValue, windowManager.mode, windowManager.inputWidth]);

  const toggleExpand = async () => {
    if (windowManager.mode !== 'mini') {
      handleReset();
    } else {
      await windowManager.changeMode('input');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const startDrag = (e: PointerEvent) => {
    if ("button" in e && e.button !== 0) return;
    if (isClickThrough) return;
    e.preventDefault();
    e.stopPropagation();
    void appWindow.startDragging();
  };

  return (
    <div className={`container ${isClickThrough ? "click-through-mode" : ""}`}>

      <div className="drag-handle" onPointerDown={startDrag}>
        <div className="handle-bar"></div>
      </div>

      {/* Content wrapper for proper resize handle positioning */}
      <div className="content-wrapper" ref={contentWrapperRef}>
        <MotionConfig transition={{ type: "spring", stiffness: 350, damping: 30 }}>

          <Capsule
            isThinking={isBusy}
            messageCount={messages.length}
            windowMode={windowManager.mode}
            onClick={toggleExpand}
            disabled={isClickThrough}
          />

          {windowManager.mode !== 'mini' && (
            <PromptInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={async () => {
                const textToSend = inputValue.trim();
                if (!textToSend) return;
                
                setInputValue("");
                sendMessage({ text: textToSend });
                
                if (windowManager.mode === 'input') {
                  const inheritWidth = windowManager.inputWidth;
                  void windowManager
                    .changeMode('result', inheritWidth ? { w: inheritWidth, h: 500 } : undefined)
                    .catch(() => undefined);
                }
              }}
              onStop={stop}
              onClearChat={handleClearChat}
              isStreaming={status === "streaming"}
              isSubmitting={status === "submitted"}
              disabled={isClickThrough}
              model={selectedModel}
              onModelChange={setSelectedModel}
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
            <div className="chat-error">
              {error.message || String(error)}
            </div>
          )}

        </MotionConfig>
      </div>

      {/* Resize handle positioned relative to container */}
      {(windowManager.mode === 'input' || windowManager.mode === 'result') && !isClickThrough && (
        <ResizeHandle
          onResize={windowManager.applyResize}
          onResizeStart={windowManager.startResize}
        />
      )}
    </div>
  );
}

export default App;
