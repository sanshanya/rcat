import { useEffect, useRef } from "react";
import type { ChatStatus, UIMessage } from "ai";
import { Streamdown } from "streamdown";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ThinkingIndicator } from "@/components/ai-elements/thinking-indicator";

interface ChatMessagesProps {
  messages: UIMessage[];
  status: ChatStatus;
}

const ChatMessages = ({ messages, status }: ChatMessagesProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, status]);

  return (
    <div className="chat-panel" ref={scrollRef}>
      {messages
        .filter((message) => message.role !== "system")
        .map((message) => (
          <div key={message.id} className={`chat-message ${message.role}`}>
            <div className="chat-role">
              {message.role === "user" ? "You" : "AI"}
            </div>
            <div className="chat-content">
              {message.parts.map((part, index) => {
                const isStreaming = status === "streaming" && message.role === "assistant";
                
                if (part.type === "text") {
                  return (
                    <Streamdown 
                      key={index} 
                      isAnimating={isStreaming}
                      shikiTheme={["github-dark", "github-dark"]}
                    >
                      {part.text}
                    </Streamdown>
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
              })}
            </div>
          </div>
        ))}

      {status === "submitted" && (
        <div className="chat-message assistant">
          <div className="chat-role">AI</div>
          <div className="chat-content">
            <ThinkingIndicator isThinking={true} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatMessages;
