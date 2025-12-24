import { useState, useEffect, useRef, useCallback } from "react";
import "./styles/index.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, MotionConfig } from "framer-motion";

import { Capsule, ChatInput, MessageList, ResizeHandle } from "./components";
import { EVT_CLICK_THROUGH_STATE, AUTO_RESIZE_MAX_WIDTH, INPUT_PADDING } from "./constants";
import { useWindowManager, useChatSession, useTauriEvent } from "./hooks";
import { measureTextWidth } from "./utils";

const appWindow = getCurrentWindow();

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);

  // Use custom hooks for cleaner separation of concerns
  const windowManager = useWindowManager();
  const chatSession = useChatSession();

  // Input ref for focus handling
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");

  // Listen for click-through state changes from Rust
  const handleClickThroughChange = useCallback((event: { payload: boolean }) => {
    setIsClickThrough(event.payload);
    if (event.payload) {
      handleReset();
    }
  }, []);

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

  const handleReset = () => {
    chatSession.clearSession();
    setInputValue("");
    windowManager.reset();
  };

  const toggleExpand = async () => {
    if (windowManager.mode !== 'mini') {
      handleReset();
    } else {
      await windowManager.changeMode('input');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && inputValue.trim()) {
      e.preventDefault();

      const textToSend = inputValue.trim();
      setInputValue("");

      if (windowManager.mode === 'input') {
        // Inherit manual width to result mode
        const inheritWidth = windowManager.inputWidth;
        await windowManager.changeMode('result', inheritWidth ? { w: inheritWidth, h: 500 } : undefined);
      }

      chatSession.sendMessage(textToSend);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
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
          isThinking={chatSession.isThinking}
          messageCount={chatSession.messages.length}
          windowMode={windowManager.mode}
          onClick={toggleExpand}
          disabled={isClickThrough}
        />

        <AnimatePresence>

          {windowManager.mode !== 'mini' && (
            <ChatInput
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={chatSession.isThinking || chatSession.isStreaming}
            />
          )}

          {chatSession.messages.length > 0 && (
            <MessageList
              messages={chatSession.messages}
              isThinking={chatSession.isThinking}
              isStreaming={chatSession.isStreaming}
              onRetry={chatSession.retryMessage}
            />
          )}

        </AnimatePresence>

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