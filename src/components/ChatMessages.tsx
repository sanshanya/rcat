import { useEffect, useRef } from "react";
import type { ChatStatus, UIMessage } from "ai";
import { Streamdown } from "streamdown";

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
                if (part.type === "text") {
                  return (
                    <Streamdown key={index} mode="streaming">
                      {part.text}
                    </Streamdown>
                  );
                }

                if (part.type === "reasoning") {
                  return (
                    <details key={index} className="chat-reasoning">
                      <summary>Show reasoning</summary>
                      <div className="chat-reasoning-body">
                        <Streamdown mode="streaming">
                          {part.text}
                        </Streamdown>
                      </div>
                    </details>
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
            <span className="thinking-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatMessages;
