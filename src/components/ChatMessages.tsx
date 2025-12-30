import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatStatus, UIMessage } from "ai";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { ThinkingIndicator } from "@/components/ai-elements/thinking-indicator";
import { Loader2 } from "lucide-react";

import AssistantMessage from "./chat/AssistantMessage";
import UserMessage from "./chat/UserMessage";
import { getMessageText } from "./chat/messageText";

interface ChatMessagesProps {
  conversationId?: string | null;
  isBackgroundGenerating?: boolean;
  messages: UIMessage[];
  status: ChatStatus;
  hasMoreHistory?: boolean;
  onLoadMoreHistory?: () => void | Promise<unknown>;
  onRegenerate?: (messageId: string) => void;
  onBranch?: (messageId: string) => void | Promise<unknown>;
  onEditMessage?: (messageId: string, newText: string) => void;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 32;

const isAtBottom = (el: HTMLElement) =>
  el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX;

const scrollToBottom = (el: HTMLElement) => {
  el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
};

const ChatMessages = ({
  conversationId = null,
  isBackgroundGenerating = false,
  messages,
  status,
  hasMoreHistory = false,
  onLoadMoreHistory,
  onRegenerate,
  onBranch,
  onEditMessage,
}: ChatMessagesProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const branchResetTimeoutRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const autoScrollRafRef = useRef<number | null>(null);
  const forceStickUntilMsRef = useRef(0);
  const prevStatusRef = useRef<ChatStatus | null>(null);
  const lastMessageCountRef = useRef<{ conversationId: string | null; count: number }>({
    conversationId,
    count: messages.length,
  });

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null);
  const [branchedMessageId, setBranchedMessageId] = useState<string | null>(null);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  const scheduleScrollToBottomIfPinned = useCallback(() => {
    const now = Date.now();
    const shouldForce = forceStickUntilMsRef.current > now;
    if (!shouldForce && !stickToBottomRef.current) return;
    if (autoScrollRafRef.current !== null) return;
    autoScrollRafRef.current = requestAnimationFrame(() => {
      autoScrollRafRef.current = null;
      const nowInner = Date.now();
      const shouldForceInner = forceStickUntilMsRef.current > nowInner;
      if (!shouldForceInner && !stickToBottomRef.current) return;
      const container = scrollRef.current;
      if (!container) return;
      scrollToBottom(container);
      stickToBottomRef.current = true;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    stickToBottomRef.current = isAtBottom(container);
    if (!stickToBottomRef.current) {
      // The user intentionally moved away from the bottom; stop any forced follow.
      forceStickUntilMsRef.current = 0;
    }
  }, []);

  // On conversation switch, always jump to bottom (no per-conversation scroll memory).
  useLayoutEffect(() => {
    setBranchingMessageId(null);
    setBranchedMessageId(null);
    if (branchResetTimeoutRef.current) {
      window.clearTimeout(branchResetTimeoutRef.current);
      branchResetTimeoutRef.current = null;
    }
    stickToBottomRef.current = true;
    forceStickUntilMsRef.current = Date.now() + 1800;
    const container = scrollRef.current;
    if (container) {
      scrollToBottom(container);
    }
    scheduleScrollToBottomIfPinned();
    const raf = requestAnimationFrame(() => scheduleScrollToBottomIfPinned());
    const timeout = window.setTimeout(() => scheduleScrollToBottomIfPinned(), 180);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [conversationId, scheduleScrollToBottomIfPinned]);

  // When a stream finishes, the final render (reasoning/markdown) can change heights after
  // status flips; keep a short forced follow window to avoid a visible "bounce".
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (!prev) return;
    const wasStreaming = prev === "streaming" || prev === "submitted";
    const isStreaming = status === "streaming" || status === "submitted";
    if (!wasStreaming || isStreaming) return;
    if (!stickToBottomRef.current) return;
    forceStickUntilMsRef.current = Date.now() + 1600;
    scheduleScrollToBottomIfPinned();
  }, [scheduleScrollToBottomIfPinned, status]);

  // Keep auto-follow working even when content changes outside React (markdown/image load,
  // syntax highlighting, window resize, etc.). We only auto-scroll when pinned to bottom.
  useEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(scheduleScrollToBottomIfPinned)
        : null;
    mo?.observe(content, { childList: true, subtree: true, characterData: true });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleScrollToBottomIfPinned)
        : null;
    ro?.observe(container);
    ro?.observe(content);

    scheduleScrollToBottomIfPinned();
    return () => {
      mo?.disconnect();
      ro?.disconnect();
    };
  }, [scheduleScrollToBottomIfPinned]);

  useLayoutEffect(() => {
    scheduleScrollToBottomIfPinned();
  }, [messages, status, isBackgroundGenerating, scheduleScrollToBottomIfPinned]);

  // After sending a message, force-scroll to bottom once so the user can focus on the reply.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const last = messages[messages.length - 1];
    const prev = lastMessageCountRef.current;
    const sameConversation = prev.conversationId === conversationId;
    lastMessageCountRef.current = { conversationId, count: messages.length };

    if (sameConversation && conversationId && messages.length > prev.count && last?.role === "user") {
      stickToBottomRef.current = true;
      scrollToBottom(container);
    }
  }, [conversationId, messages]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      if (branchResetTimeoutRef.current) {
        window.clearTimeout(branchResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = (messageId: string, text: string) => {
    if (!navigator.clipboard?.writeText) return;

    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedMessageId(messageId);
        if (copyResetTimeoutRef.current) {
          window.clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = window.setTimeout(
          () => setCopiedMessageId(null),
          2000
        );
      })
      .catch(() => {
        // Ignore clipboard failures (permission, unsupported, etc.)
      });
  };

  const handleBranch = useCallback(
    async (messageId: string) => {
      if (!onBranch) return;
      if (branchingMessageId) return;

      setBranchingMessageId(messageId);
      try {
        await onBranch(messageId);
        setBranchedMessageId(messageId);
        if (branchResetTimeoutRef.current) {
          window.clearTimeout(branchResetTimeoutRef.current);
        }
        branchResetTimeoutRef.current = window.setTimeout(() => {
          setBranchedMessageId(null);
          branchResetTimeoutRef.current = null;
        }, 1200);
      } catch {
        // Backend errors are already reported; keep UI quiet and reset state.
      } finally {
        setBranchingMessageId(null);
      }
    },
    [branchingMessageId, onBranch]
  );

  const handleLoadMoreHistory = useCallback(async () => {
    if (!onLoadMoreHistory) return;
    if (loadingMoreHistory) return;
    if (status === "streaming" || status === "submitted") return;

    const container = scrollRef.current;
    const preserveScroll = container ? !isAtBottom(container) : false;
    const prevHeight = container?.scrollHeight ?? 0;
    const prevTop = container?.scrollTop ?? 0;

    setLoadingMoreHistory(true);
    try {
      await onLoadMoreHistory();
    } finally {
      setLoadingMoreHistory(false);
    }

    if (!preserveScroll) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const delta = el.scrollHeight - prevHeight;
      if (delta <= 0) return;
      el.scrollTop = prevTop + delta;
    });
  }, [loadingMoreHistory, onLoadMoreHistory, status]);

  const startEditing = (message: UIMessage) => {
    setEditingMessageId(message.id);
    setEditText(getMessageText(message));
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditText("");
  };

  const confirmEdit = (messageId: string) => {
    if (editText.trim() && onEditMessage) {
      onEditMessage(messageId, editText.trim());
    }
    cancelEditing();
  };

  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;

  return (
    <div
      className="min-h-[220px] w-full flex-1 overflow-y-auto rounded-xl border border-border/50 bg-muted/50 p-3 pr-2 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere] select-text cursor-text"
      ref={scrollRef}
      onScroll={handleScroll}
    >
      <div ref={contentRef} className="flex flex-col gap-3">
        {hasMoreHistory && onLoadMoreHistory ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-1 text-xs text-foreground/80 hover:bg-background/60 disabled:opacity-60"
              onClick={() => void handleLoadMoreHistory()}
              disabled={
                loadingMoreHistory || status === "streaming" || status === "submitted"
              }
            >
              {loadingMoreHistory ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <span>加载中…</span>
                </>
              ) : (
                <span>加载更早消息</span>
              )}
            </button>
          </div>
        ) : null}
        {messages
          .filter((message) => message.role !== "system")
          .map((message) => {
            const isStreaming =
              status === "streaming" &&
              message.role === "assistant" &&
              message.id === lastAssistantId;
            const isEditing = editingMessageId === message.id;
            const isCopied = copiedMessageId === message.id;
            const isBranching = branchingMessageId === message.id;
            const isBranched = branchedMessageId === message.id;

            if (message.role === "user") {
              return (
                <UserMessage
                  key={message.id}
                  message={message}
                  isEditing={isEditing}
                  editText={editText}
                  onEditTextChange={setEditText}
                  onCancelEditing={cancelEditing}
                  onConfirmEditing={() => confirmEdit(message.id)}
                  onStartEditing={() => startEditing(message)}
                  onCopy={() => handleCopy(message.id, getMessageText(message))}
                  isCopied={isCopied}
                  canEdit={Boolean(onEditMessage)}
                />
              );
            }

            return (
              <AssistantMessage
                key={message.id}
                message={message}
                isStreaming={isStreaming}
                onCopy={() => handleCopy(message.id, getMessageText(message))}
                isCopied={isCopied}
                onRegenerate={onRegenerate ? () => onRegenerate(message.id) : undefined}
                onBranch={onBranch ? () => void handleBranch(message.id) : undefined}
                isBranching={isBranching}
                isBranched={isBranched}
              />
            );
          })}

        {isBackgroundGenerating && (
          <Message from="assistant">
            <MessageContent>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>后台生成中…</span>
              </div>
            </MessageContent>
          </Message>
        )}

        {status === "submitted" && (
          <Message from="assistant">
            <MessageContent>
              <ThinkingIndicator isThinking={true} />
            </MessageContent>
          </Message>
        )}
      </div>
    </div>
  );
};

export default ChatMessages;
