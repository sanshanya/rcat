import { useEffect, useRef, useState } from "react";
import type { ChatStatus, UIMessage } from "ai";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { ThinkingIndicator } from "@/components/ai-elements/thinking-indicator";

import AssistantMessage from "./chat/AssistantMessage";
import UserMessage from "./chat/UserMessage";
import { getMessageText } from "./chat/messageText";

interface ChatMessagesProps {
  messages: UIMessage[];
  status: ChatStatus;
  onRegenerate?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
}

const ChatMessages = ({
  messages,
  status,
  onRegenerate,
  onEditMessage,
}: ChatMessagesProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, status]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
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
      className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border/50 bg-muted/30 p-3 pr-2 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere] select-text cursor-text"
      ref={scrollRef}
    >
      {messages
        .filter((message) => message.role !== "system")
        .map((message) => {
          const isStreaming =
            status === "streaming" &&
            message.role === "assistant" &&
            message.id === lastAssistantId;
          const isEditing = editingMessageId === message.id;
          const isCopied = copiedMessageId === message.id;

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
            />
          );
        })}

      {status === "submitted" && (
        <Message from="assistant">
          <MessageContent>
            <ThinkingIndicator isThinking={true} />
          </MessageContent>
        </Message>
      )}
    </div>
  );
};

export default ChatMessages;
