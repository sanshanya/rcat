import type { UIMessage } from "ai";
import {
  CheckIcon,
  CopyIcon,
  GitBranchIcon,
  Loader2,
  PlayIcon,
  RefreshCcwIcon,
} from "lucide-react";

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
  onBranch?: () => void;
  onSpeak?: () => void;
  isBranching?: boolean;
  isBranched?: boolean;
};

export default function AssistantMessage({
  message,
  isStreaming,
  onCopy,
  isCopied,
  onRegenerate,
  onBranch,
  onSpeak,
  isBranching = false,
  isBranched = false,
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
          {onBranch && (
            <MessageAction
              label="Branch"
              tooltip={
                isBranching
                  ? "Branching…"
                  : isBranched
                    ? "Branched!"
                    : "Branch conversation"
              }
              onClick={onBranch}
              disabled={isBranching}
              aria-busy={isBranching}
            >
              {isBranching ? (
                <Loader2 className="size-3 animate-spin" />
              ) : isBranched ? (
                <CheckIcon className="size-3 text-green-400" />
              ) : (
                <GitBranchIcon className="size-3" />
              )}
            </MessageAction>
          )}
          {onSpeak && (
            <MessageAction label="Play" tooltip="Play audio" onClick={onSpeak}>
              <PlayIcon className="size-3" />
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
