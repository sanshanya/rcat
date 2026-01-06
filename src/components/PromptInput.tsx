import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type FormEvent,
} from "react";
import {
  Eye,
  EyeOff,
  Mic,
  MicOff,
  Plus,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/constants";
import { useAutosizeTextarea, useSpeechRecognition } from "@/hooks";
import type { ConversationSummary } from "@/types";
import { HistoryDropdown } from "@/components/prompt/HistoryDropdown";
import { ModelSelector } from "@/components/prompt/ModelSelector";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoiceSubmit?: (text: string) => void;
  onStop?: () => void;
  onOpenSettings?: () => void;
  conversations?: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation?: (conversationId: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (conversationId: string) => void;
  onRenameConversation?: (conversationId: string, title: string) => void | Promise<unknown>;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  isConversationGenerating?: boolean;
  disabled?: boolean;
  hasHistoryNotification?: boolean;
  model: string;
  modelOptions: ModelOption[];
  onModelChange: (model: string) => void;
  toolMode?: boolean;
  onToolModeChange?: (enabled: boolean) => void;
  voiceMode?: boolean;
  onVoiceModeChange?: (enabled: boolean) => void;
}

export const PromptInput = forwardRef<HTMLTextAreaElement, PromptInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onVoiceSubmit,
      onStop,
      onOpenSettings,
      conversations = [],
      activeConversationId,
      onSelectConversation,
      onNewConversation,
      onDeleteConversation,
      onRenameConversation,
      isStreaming = false,
      isSubmitting = false,
      isConversationGenerating = false,
      disabled = false,
      hasHistoryNotification = false,
      model,
      modelOptions,
      onModelChange,
      toolMode = false,
      onToolModeChange,
      voiceMode = false,
      onVoiceModeChange,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const { isListening, toggleListening, lastError: voiceInputError } = useSpeechRecognition({
      value,
      onChange,
      disabled,
      lang: "zh-CN",
      conversationId: activeConversationId,
      onFinal: onVoiceSubmit,
    });

    const isGenerating = isConversationGenerating || isStreaming || isSubmitting;

    const submitOrStop = () => {
      if (disabled) return;
      if (isGenerating) {
        onStop?.();
        return;
      }
      if (value.trim()) onSubmit();
    };

    const { autoResize } = useAutosizeTextarea(textareaRef, value);

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitOrStop();
    };

    return (
      <form
        data-window-prompt
        className={cn(
          "flex w-full shrink-0 flex-col gap-2 rounded-2xl border border-border/50",
          "bg-muted/80 p-3 shadow-md"
        )}
        onSubmit={handleSubmit}
      >
        <textarea
          ref={textareaRef}
          className={cn(
            "w-full min-h-[44px] resize-none overflow-y-auto max-h-[max(160px,25vh)]",
            "bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground outline-none",
            "placeholder:text-muted-foreground select-text"
          )}
          placeholder="Say something..."
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            autoResize(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitOrStop();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={disabled}
          rows={1}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50"
              )}
              disabled={disabled || !onNewConversation}
              onClick={onNewConversation}
              onPointerDown={(e) => e.stopPropagation()}
              title="新对话"
            >
              <Plus className="size-4" />
            </button>

            <HistoryDropdown
              disabled={disabled}
              conversations={conversations}
              activeConversationId={activeConversationId}
              hasNotification={hasHistoryNotification}
              onSelectConversation={onSelectConversation}
              onDeleteConversation={onDeleteConversation}
              onRenameConversation={onRenameConversation}
            />

            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50"
              )}
              disabled={disabled || !onOpenSettings}
              onClick={onOpenSettings}
              onPointerDown={(e) => e.stopPropagation()}
              title="设置"
            >
              <Settings className="size-4" />
            </button>

            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
                toolMode && "bg-red-500/20 text-red-500 hover:bg-red-500/25 hover:text-red-500"
              )}
              disabled={disabled}
              onClick={() => onToolModeChange?.(!toolMode)}
              onPointerDown={(e) => e.stopPropagation()}
              title={toolMode ? "关闭工具模式" : "开启工具模式 (AI可查看屏幕)"}
            >
              {toolMode ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )}
            </button>

            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
                isListening && "bg-red-500/20 text-red-500 hover:bg-red-500/25 hover:text-red-500"
              )}
              disabled={disabled}
              onClick={toggleListening}
              onPointerDown={(e) => e.stopPropagation()}
              title={isListening ? "停止录音" : "语音输入"}
            >
              {isListening ? (
                <MicOff className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>

            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
                voiceMode &&
                  "bg-green-500/20 text-green-500 hover:bg-green-500/25 hover:text-green-500"
              )}
              disabled={disabled}
              onClick={() => onVoiceModeChange?.(!voiceMode)}
              onPointerDown={(e) => e.stopPropagation()}
              title={voiceMode ? "关闭自动朗读" : "开启自动朗读 (AI回答自动语音输出)"}
            >
              {voiceMode ? (
                <Volume2 className="size-4" />
              ) : (
                <VolumeX className="size-4" />
              )}
            </button>

            <ModelSelector
              model={model}
              modelOptions={modelOptions}
              disabled={disabled}
              onModelChange={onModelChange}
            />
          </div>

          <button
            type="submit"
            className={cn(
              "ml-auto h-8 shrink-0 rounded-lg px-4 text-xs font-semibold text-white transition-colors",
              isGenerating
                ? "bg-red-500/90 hover:bg-red-500"
                : "bg-blue-500/90 hover:bg-blue-500",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
            disabled={disabled || (!isGenerating && !value.trim())}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isGenerating ? "Stop" : "Send"}
          </button>
        </div>

        {voiceInputError ? (
          <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
            {voiceInputError}
          </div>
        ) : null}
      </form>
    );
  }
);
PromptInput.displayName = "PromptInput";

export default PromptInput;
