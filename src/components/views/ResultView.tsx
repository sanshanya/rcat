import { useMemo, type ComponentProps } from "react";
import { Shrink } from "lucide-react";

import { Capsule } from "@/components";
import ChatMessages from "@/components/ChatMessages";
import PromptInput from "@/components/PromptInput";
import { ContextUsageIndicator } from "@/components/ai-elements/context";
import type { AiModel } from "@/types";
import { estimateLanguageModelUsageFromMessages } from "@/utils";

export type ResultViewProps = {
  capsuleProps: ComponentProps<typeof Capsule>;
  promptProps: ComponentProps<typeof PromptInput>;
  chatProps: ComponentProps<typeof ChatMessages>;
  showChat: boolean;
  modelSpec?: AiModel | null;
  errorText?: string | null;
};

export function ResultView({
  capsuleProps,
  promptProps,
  chatProps,
  showChat,
  modelSpec = null,
  errorText,
}: ResultViewProps) {
  const isGenerating = Boolean(
    promptProps.isConversationGenerating || promptProps.isStreaming || promptProps.isSubmitting
  );
  const showStatusBar = (chatProps.messages?.length ?? 0) > 0 || isGenerating;

  const estimatedUsage = useMemo(
    () =>
      estimateLanguageModelUsageFromMessages({
        messages: chatProps.messages,
        draftText: promptProps.value,
        isGenerating,
      }),
    [chatProps.messages, isGenerating, promptProps.value]
  );

  return (
    <>
      <Capsule {...capsuleProps} />
      <PromptInput {...promptProps} />
      {showChat ? <ChatMessages {...chatProps} /> : null}
      {errorText ? (
        <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
          {errorText}
        </div>
      ) : null}
      {showStatusBar ? (
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex items-center gap-1">
            <ContextUsageIndicator
              usage={estimatedUsage}
              estimated
              maxTokens={modelSpec?.maxContext ?? null}
              maxOutputTokens={modelSpec?.maxOutput ?? null}
            />
            <button
              type="button"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground cursor-not-allowed opacity-50"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.preventDefault()}
              aria-disabled="true"
              title="上下文压缩（暂未实现）"
            >
              <Shrink className="size-4" />
              <span className="sr-only">压缩上下文</span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default ResultView;
