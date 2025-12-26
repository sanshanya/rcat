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
import {
  EVT_CLICK_THROUGH_STATE,
  AUTO_RESIZE_MAX_WIDTH,
  INPUT_PADDING,
} from "./constants";
import { useWindowManager, useTauriEvent } from "./hooks";
import { isTauriContext, measureTextWidth } from "./utils";
import { createTauriChatTransport, captureScreenText, analyzeScreenVlm, listCapturableWindows, captureSmart, getSmartWindow } from "./services";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// 暴露测试函数到全局 window 对象，方便控制台调试
if (typeof window !== 'undefined') {
  // @ts-expect-error - 临时测试用
  window.visionTest = {
    captureScreenText,
    analyzeScreenVlm,
    listCapturableWindows,
    captureSmart,
    getSmartWindow,
    // 便捷测试函数
    async testOCR() {
      console.log('🔍 开始 OCR 测试...');
      const result = await captureScreenText();
      console.log('✅ OCR 结果:', result);
      return result;
    },
    async testSmart() {
      console.log('🧠 开始智能捕获...');
      const result = await captureSmart();
      console.log('✅ 智能捕获结果:', result);
      return result;
    },
    async testVLM(prompt = '描述这个屏幕上的内容') {
      console.log('🤖 开始 VLM 分析...');
      const result = await analyzeScreenVlm(prompt);
      console.log('✅ VLM 结果:', result);
      return result;
    },
    async listWindows() {
      const windows = await listCapturableWindows();
      console.log('📋 可用窗口 (按Z序):', windows);
      return windows;
    },
    async smartWindow() {
      const win = await getSmartWindow();
      console.log('🎯 智能选中窗口:', win);
      return win;
    },
    // AI 工具调用测试
    async testToolChat(prompt = '请告诉我用户当前正在使用哪些应用程序') {
      console.log('🛠️ 开始工具调用测试...');
      const requestId = `test_${Date.now()}`;

      // 监听响应
      const unlisten = await listen('chat-stream', (event: { payload: { delta: string; kind: string; done: boolean } }) => {
        const { delta, kind, done } = event.payload;
        if (done) {
          console.log('✅ 完成');
          return;
        }
        if (kind === 'reasoning') {
          console.log('🔧', delta);
        } else {
          console.log('💬', delta);
        }
      });

      try {
        await invoke('chat_stream_with_tools', {
          requestId,
          messages: [{ role: 'user', content: prompt }],
          model: null,
          requestOptions: null
        });
        // 等待一段时间让流完成
        await new Promise(resolve => setTimeout(resolve, 10000));
      } finally {
        unlisten();
      }
    }
  };
  console.log('💡 测试: visionTest.testToolChat("帮我看看QQ消息")');
}

const createChatSessionId = () =>
  `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);

  // Use custom hooks for cleaner separation of concerns
  const {
    mode: windowMode,
    inputWidth,
    changeMode,
    reset: resetWindow,
    startResize,
    applyResize,
    requestAutoResize,
  } = useWindowManager();
  const [selectedModel, setSelectedModel] = useState("deepseek-reasoner");
  const selectedModelRef = useRef(selectedModel);
  const [toolMode, setToolMode] = useState(false);
  const toolModeRef = useRef(toolMode);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

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
  const contentWrapperRef = useRef<HTMLDivElement>(null);
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

  // Auto-resize input width based on text content
  const resizeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (windowMode !== "input") return;
    if (inputWidth !== null) return; // Skip if manual override

    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = window.setTimeout(() => {
      const textWidth = measureTextWidth(inputValue, inputRef.current);
      const desiredWidth = Math.min(
        textWidth + INPUT_PADDING,
        AUTO_RESIZE_MAX_WIDTH
      );
      requestAutoResize(desiredWidth);
    }, 50);

    return () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    };
  }, [inputValue, inputWidth, requestAutoResize, windowMode]);

  const toggleExpand = async () => {
    if (windowMode !== "mini") {
      handleReset();
    } else {
      await changeMode("input");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const startDrag = (e: PointerEvent) => {
    if ("button" in e && e.button !== 0) return;
    if (isClickThrough) return;
    if (!isTauriContext()) return;
    e.preventDefault();
    e.stopPropagation();
    void getCurrentWindow().startDragging().catch(() => undefined);
  };

  return (
    <div className={`container ${isClickThrough ? "click-through-mode" : ""}`}>
      <div className="drag-handle" onPointerDown={startDrag}>
        <div className="handle-bar"></div>
      </div>

      {/* Content wrapper for proper resize handle positioning */}
      <div className="content-wrapper" ref={contentWrapperRef}>
        <MotionConfig
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        >
          <Capsule
            isThinking={isBusy}
            messageCount={messages.length}
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
                  const inheritWidth = inputWidth;
                  void changeMode(
                    "result",
                    inheritWidth ? { w: inheritWidth, h: 500 } : undefined
                  )
                    .catch(() => undefined);
                }
              }}
              onStop={stop}
              onClearChat={handleClearChat}
              isStreaming={status === "streaming"}
              isSubmitting={status === "submitted"}
              disabled={isClickThrough}
              windowMode={windowMode}
              model={selectedModel}
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
            <div className="chat-error">{error.message || String(error)}</div>
          )}

          {/* Resize handle positioned relative to content-wrapper */}
          {(windowMode === "input" || windowMode === "result") &&
            !isClickThrough && (
              <ResizeHandle
                onResize={applyResize}
                onResizeStart={startResize}
              />
            )}
        </MotionConfig>
      </div>
    </div>
  );
}

export default App;
