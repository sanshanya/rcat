import type { UIMessage } from "ai";
import { CheckIcon, CopyIcon, RefreshCcwIcon } from "lucide-react";

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

type AssistantMessageProps = {
  message: UIMessage;
  isStreaming: boolean;
  onCopy: () => void;
  isCopied: boolean;
  onRegenerate?: () => void;
};

export default function AssistantMessage({
  message,
  isStreaming,
  onCopy,
  isCopied,
  onRegenerate,
}: AssistantMessageProps) {
  return (
    <Message from="assistant">
      <MessageContent className="select-text">
        {message.parts.map((part, index) => {
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
              <div key={index} className="text-xs">
                <a
                  className="text-blue-400 hover:underline"
                  href={part.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {part.title || part.url}
                </a>
              </div>
            );
          }

          if (part.type === "file") {
            return (
              <div key={index} className="text-xs">
                <a
                  className="text-blue-400 hover:underline"
                  href={part.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {part.mediaType}
                </a>
              </div>
            );
          }

          return null;
        })}
      </MessageContent>

      {!isStreaming && (
        <MessageActions>
          {onRegenerate && (
            <MessageAction
              label="Retry"
              tooltip="Regenerate response"
              onClick={onRegenerate}
            >
              <RefreshCcwIcon className="size-3" />
            </MessageAction>
          )}
          <MessageAction
            label="Copy"
            tooltip={isCopied ? "Copied!" : "Copy to clipboard"}
            onClick={onCopy}
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
}
