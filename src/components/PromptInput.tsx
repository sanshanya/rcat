import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Eye, EyeOff, Mic, MicOff, Plus, Settings, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import { INPUT_HEIGHT_COLLAPSED, INPUT_HEIGHT_EXPANDED, MODEL_OPTIONS } from "@/constants";
import type { WindowMode } from "@/types";
import { isTauriContext } from "@/utils";

const MAX_TEXTAREA_HEIGHT_PX = 200;

type SpeechRecognitionResultLike = {
  0: { transcript: string };
  isFinal: boolean;
  length: number;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  onClearChat?: () => void;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  disabled?: boolean;
  windowMode: WindowMode;
  model: string;
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
      windowMode,
      model,
      onModelChange,
      toolMode = false,
      onToolModeChange,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const [isListening, setIsListening] = useState(false);
    const [modelSelectOpen, setModelSelectOpen] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const listeningBaseValueRef = useRef("");

    const isBusy = isStreaming || isSubmitting;
    const isModelSelectExpandedRef = useRef(false);
    const isModelSelectOpeningRef = useRef(false);
    const modelSelectOpenTimeoutRef = useRef<number | null>(null);

    const autoResize = (el: HTMLTextAreaElement) => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
    };

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      autoResize(el);
    }, [value]);

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

    const setInputWindowHeight = useCallback(
      async (height: number) => {
        if (!isTauriContext()) return;
        if (windowMode !== "input") return;
        try {
          await invoke("resize_input_height", { desiredHeight: height });
        } catch {
          // Ignore resize failures
        }
      },
      [windowMode]
    );

    const expandForModelSelect = useCallback(() => {
      if (isModelSelectExpandedRef.current) return;
      isModelSelectExpandedRef.current = true;
      return setInputWindowHeight(INPUT_HEIGHT_EXPANDED);
    }, [setInputWindowHeight]);

    const collapseAfterModelSelect = useCallback(() => {
      if (!isModelSelectExpandedRef.current) return;
      isModelSelectExpandedRef.current = false;
      return setInputWindowHeight(INPUT_HEIGHT_COLLAPSED);
    }, [setInputWindowHeight]);

    useEffect(() => {
      if (windowMode !== "input") {
        // Reset the expansion flag when leaving input mode so next open can expand again.
        isModelSelectExpandedRef.current = false;
        return;
      }

      if (modelSelectOpen) {
        void expandForModelSelect();
      } else {
        void collapseAfterModelSelect();
      }
    }, [collapseAfterModelSelect, expandForModelSelect, modelSelectOpen, windowMode]);

    useEffect(() => {
      return () => {
        if (modelSelectOpenTimeoutRef.current !== null) {
          window.clearTimeout(modelSelectOpenTimeoutRef.current);
          modelSelectOpenTimeoutRef.current = null;
        }
        isModelSelectOpeningRef.current = false;
      };
    }, []);

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitOrStop();
    };

    const startListening = useCallback(() => {
      const SpeechRecognition = (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).SpeechRecognition
        ?? (
          window as Window & {
            SpeechRecognition?: SpeechRecognitionConstructor;
            webkitSpeechRecognition?: SpeechRecognitionConstructor;
          }
        ).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        console.warn("Speech recognition not supported");
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "zh-CN";

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let finalTranscript = "";
        let interimTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (result?.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }
        onChange(
          `${listeningBaseValueRef.current}${finalTranscript}${interimTranscript}`
        );
      };

      recognition.onerror = (event: { error: string }) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      listeningBaseValueRef.current = value;
      recognition.start();
      setIsListening(true);
    }, [onChange, value]);

    const stopListening = useCallback(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
      }
    }, []);

    const toggleListening = useCallback(() => {
      if (disabled) return;
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    }, [disabled, isListening, startListening, stopListening]);

    useEffect(() => {
      return () => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      };
    }, []);

    return (
      <form className="prompt-input-container" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="prompt-input-field"
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

        <div className="prompt-input-toolbar">
          <div className="prompt-input-tools">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="prompt-input-tool-btn"
                  disabled={disabled}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Plus className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
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
              className={`prompt-input-tool-btn ${toolMode ? "active" : ""}`}
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
              className={`prompt-input-tool-btn ${isListening ? "active" : ""}`}
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
              disabled={disabled}
              open={modelSelectOpen}
              onOpenChange={(open) => {
                // Ignore transient open/close toggles triggered by the same pointer gesture
                // while we're resizing the Tauri window before opening the menu.
                if (isModelSelectOpeningRef.current) return;
                setModelSelectOpen(open);
              }}
            >
              <SelectTrigger
                className="prompt-input-model-select"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  if (windowMode !== "input") return;
                  if (modelSelectOpen) return;
                  if (isModelSelectOpeningRef.current) return;

                  // Prevent Radix from opening immediately; resizing the Tauri window here
                  // can cause the dropdown to instantly close due to pointer/focus changes.
                  e.preventDefault();

                  isModelSelectOpeningRef.current = true;

                  const pointerEndPromise = new Promise<void>((resolve) => {
                    const done = () => {
                      window.removeEventListener("pointerup", onPointerEnd, true);
                      window.removeEventListener("pointercancel", onPointerEnd, true);
                      resolve();
                    };
                    const onPointerEnd = () => done();
                    window.addEventListener("pointerup", onPointerEnd, true);
                    window.addEventListener("pointercancel", onPointerEnd, true);
                  });

                  void Promise.all([
                    expandForModelSelect() ?? Promise.resolve(),
                    pointerEndPromise,
                  ]).then(() => {
                    // Defer to the next tick so the trigger's click event can't immediately
                    // toggle the Select closed right after we programmatically open it.
                    modelSelectOpenTimeoutRef.current = window.setTimeout(() => {
                      modelSelectOpenTimeoutRef.current = null;
                      setModelSelectOpen(true);
                      isModelSelectOpeningRef.current = false;
                    }, 0);
                  });
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" align="end" sideOffset={4}>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            type="submit"
            className={`prompt-input-submit ${isStreaming ? "stop" : ""}`}
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
