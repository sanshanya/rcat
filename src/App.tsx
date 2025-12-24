import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type FormEvent,
  type PointerEvent,
} from "react";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MotionConfig } from "framer-motion";
import { useChat } from "@ai-sdk/react";

import { Capsule, ResizeHandle } from "./components";
import ChatMessages from "./components/ChatMessages";
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
  const { messages, status, sendMessage, error } = useChat({
    id: chatSessionId,
    transport,
  });
  const isBusy = status === "submitted" || status === "streaming";

  // Input ref for focus handling
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");

  const handleReset = useCallback(() => {
    setChatSessionId(createChatSessionId());
    setInputValue("");
    windowManager.reset();
  }, [windowManager]);

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

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();

    const textToSend = inputValue.trim();
    if (!textToSend || isBusy) return;

    setInputValue("");
    sendMessage({ text: textToSend });

    if (windowManager.mode === 'input') {
      // Inherit manual width to result mode
      const inheritWidth = windowManager.inputWidth;
      void windowManager
        .changeMode('result', inheritWidth ? { w: inheritWidth, h: 500 } : undefined)
        .catch(() => undefined);
    }
  }, [inputValue, isBusy, sendMessage, windowManager]);

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

      <MotionConfig transition={{ type: "spring", stiffness: 350, damping: 30 }}>

        <Capsule
          isThinking={isBusy}
          messageCount={messages.length}
          windowMode={windowManager.mode}
          onClick={toggleExpand}
          disabled={isClickThrough}
        />

        {windowManager.mode !== 'mini' && (
          <form className="input-area" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="chat-input"
              placeholder="Say something..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={isClickThrough || isBusy}
            />
            <button
              className="send-button"
              type="submit"
              disabled={isClickThrough || isBusy || !inputValue.trim()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Send
            </button>
          </form>
        )}

        {messages.length > 0 && (
          <ChatMessages
            messages={messages}
            status={status}
          />
        )}

        {status === "error" && error && (
          <div className="chat-error">
            {error.message || String(error)}
          </div>
        )}

      </MotionConfig>

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
