import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type FormEvent,
} from "react";
import { Eye, EyeOff, Mic, MicOff, Plus, Settings, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ModelOption } from "@/constants";
import { useSpeechRecognition } from "@/hooks";

const TEXTAREA_MAX_HEIGHT_SCREEN_RATIO = 0.25;
const MIN_TEXTAREA_MAX_HEIGHT_PX = 160;

const getTextareaMaxHeightPx = () => {
  if (typeof window === "undefined") return 200;
  const screenHeight = window.screen?.availHeight ?? window.innerHeight ?? 800;
  return Math.max(
    MIN_TEXTAREA_MAX_HEIGHT_PX,
    Math.floor(screenHeight * TEXTAREA_MAX_HEIGHT_SCREEN_RATIO)
  );
};

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  onClearChat?: () => void;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  disabled?: boolean;
  model: string;
  modelOptions: ModelOption[];
  onModelChange: (model: string) => void;
  toolMode?: boolean;
  onToolModeChange?: (enabled: boolean) => void;
}

export const PromptInput = forwardRef<HTMLTextAreaElement, PromptInputProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onStop,
      onClearChat,
      isStreaming = false,
      isSubmitting = false,
      disabled = false,
      model,
      modelOptions,
      onModelChange,
      toolMode = false,
      onToolModeChange,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const { isListening, toggleListening } = useSpeechRecognition({
      value,
      onChange,
      disabled,
      lang: "zh-CN",
    });

    const isBusy = isStreaming || isSubmitting;

    const submitOrStop = () => {
      if (disabled) return;
      if (isStreaming && onStop) {
        onStop();
        return;
      }
      if (value.trim() && !isBusy) {
        onSubmit();
      }
    };

    const autoResize = useCallback(
      (el: HTMLTextAreaElement) => {
        const maxHeightPx = getTextareaMaxHeightPx();
        el.style.height = "auto";
        const nextHeight = Math.min(el.scrollHeight, maxHeightPx);
        el.style.height = `${nextHeight}px`;
      },
      []
    );

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      autoResize(el);
    }, [autoResize, value]);

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitOrStop();
    };

    return (
      <form
        className={cn(
          "flex w-full flex-col gap-2 rounded-2xl border border-border/50",
          "bg-muted/60 p-3 shadow-md"
        )}
        onSubmit={handleSubmit}
      >
        <textarea
          ref={textareaRef}
          className={cn(
            "w-full min-h-[44px] resize-none overflow-y-auto",
            "bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground outline-none",
            "placeholder:text-muted-foreground select-text"
          )}
          style={{ maxHeight: getTextareaMaxHeightPx() }}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                    "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                    "disabled:pointer-events-none disabled:opacity-50"
                  )}
                  disabled={disabled}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Plus className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="start" sideOffset={4}>
                <DropdownMenuItem onClick={onClearChat}>
                  <Trash2 className="size-4" />
                  <span>清空对话</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <Settings className="size-4" />
                  <span>设置 (即将推出)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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

            <Select
              value={model}
              onValueChange={onModelChange}
              disabled={disabled || modelOptions.length === 0}
            >
              <SelectTrigger
                className="min-w-[100px] shrink"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="bottom" align="end" sideOffset={4}>
                {modelOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            type="submit"
            className={cn(
              "ml-auto h-8 shrink-0 rounded-lg px-4 text-xs font-semibold text-white transition-colors",
              isStreaming
                ? "bg-red-500/90 hover:bg-red-500"
                : "bg-blue-500/90 hover:bg-blue-500",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
            disabled={disabled || (!isStreaming && (isBusy || !value.trim()))}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isStreaming ? "Stop" : "Send"}
          </button>
        </div>
      </form>
    );
  }
);
PromptInput.displayName = "PromptInput";

export default PromptInput;
