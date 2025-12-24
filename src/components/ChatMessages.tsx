import { useEffect, useRef, useState } from "react";
import type { ChatStatus, UIMessage } from "ai";
import { CopyIcon, PencilIcon, RefreshCcwIcon, CheckIcon, XIcon } from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ThinkingIndicator } from "@/components/ai-elements/thinking-indicator";

interface ChatMessagesProps {
  messages: UIMessage[];
  status: ChatStatus;
  onRegenerate?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
}

const ChatMessages = ({ messages, status, onRegenerate, onEditMessage }: ChatMessagesProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  const handleCopy = (messageId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(messageId);
    // Reset after 2 seconds
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const getMessageText = (message: UIMessage): string => {
    return message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");
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

  return (
    <div className="chat-panel select-text cursor-text pr-2" ref={scrollRef}>
      {messages
        .filter((message) => message.role !== "system")
        .map((message) => {
          const isStreaming = status === "streaming" && message.role === "assistant";
          const isEditing = editingMessageId === message.id;
          const isCopied = copiedMessageId === message.id;

          return (
            <Message key={message.id} from={message.role}>
              <MessageContent className="select-text">
                {message.role === "user" ? (
                  // User message - simple text in bubble
                  isEditing ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        className="px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-slate-100 text-sm focus:outline-none focus:border-slate-400"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            confirmEdit(message.id);
                          } else if (e.key === "Escape") {
                            cancelEditing();
                          }
                        }}
                        autoFocus
                      />
                      <div className="flex gap-1 justify-end">
                        <MessageAction
                          label="Cancel"
                          tooltip="Cancel (Esc)"
                          onClick={cancelEditing}
                        >
                          <XIcon className="size-3" />
                        </MessageAction>
                        <MessageAction
                          label="Confirm"
                          tooltip="Confirm (Enter)"
                          onClick={() => confirmEdit(message.id)}
                        >
                          <CheckIcon className="size-3" />
                        </MessageAction>
                      </div>
                    </div>
                  ) : (
                    <span className="select-text">{getMessageText(message)}</span>
                  )
                ) : (
                  // Assistant message - rendered with Streamdown
                  message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <MessageResponse
                          key={index}
                          isAnimating={isStreaming}
                          shikiTheme={["github-dark", "github-dark"]}
                        >
                          {part.text}
                        </MessageResponse>
                      );
                    }

                    if (part.type === "reasoning") {
                      return (
                        <Reasoning
                          key={index}
                          isStreaming={isStreaming && index === message.parts.length - 1}
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }

                    if (part.type === "source-url") {
                      return (
                        <div key={index} className="chat-source">
                          <a href={part.url} target="_blank" rel="noreferrer">
                            {part.title || part.url}
                          </a>
                        </div>
                      );
                    }

                    if (part.type === "file") {
                      return (
                        <div key={index} className="chat-attachment">
                          <a href={part.url} target="_blank" rel="noreferrer">
                            {part.mediaType}
                          </a>
                        </div>
                      );
                    }

                    return null;
                  })
                )}
              </MessageContent>

              {/* User message actions - Copy and Edit */}
              {message.role === "user" && !isEditing && (
                <MessageActions>
                  <MessageAction
                    label="Copy"
                    tooltip={isCopied ? "Copied!" : "Copy to clipboard"}
                    onClick={() => handleCopy(message.id, getMessageText(message))}
                  >
                    {isCopied ? (
                      <CheckIcon className="size-3 text-green-400" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                  </MessageAction>
                  {onEditMessage && (
                    <MessageAction
                      label="Edit"
                      tooltip="Edit and resend"
                      onClick={() => startEditing(message)}
                    >
                      <PencilIcon className="size-3" />
                    </MessageAction>
                  )}
                </MessageActions>
              )}

              {/* Assistant message actions - Copy and Retry (all) */}
              {message.role === "assistant" && !isStreaming && (
                <MessageActions>
                  {onRegenerate && (
                    <MessageAction
                      label="Retry"
                      tooltip="Regenerate response"
                      onClick={() => onRegenerate(message.id)}
                    >
                      <RefreshCcwIcon className="size-3" />
                    </MessageAction>
                  )}
                  <MessageAction
                    label="Copy"
                    tooltip={isCopied ? "Copied!" : "Copy to clipboard"}
                    onClick={() => handleCopy(message.id, getMessageText(message))}
                  >
                    {isCopied ? (
                      <CheckIcon className="size-3 text-green-400" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                  </MessageAction>
                </MessageActions>
              )}
            </Message>
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
