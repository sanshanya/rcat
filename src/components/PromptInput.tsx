import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Mic, MicOff, Plus, Settings, Trash2 } from "lucide-react";
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
import { MODEL_OPTIONS } from "@/constants";

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
  model: string;
  onModelChange: (model: string) => void;
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
      onModelChange,
    },
    ref
  ) => {
	    const textareaRef = useRef<HTMLTextAreaElement>(null);
	    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);
	
	    const [isListening, setIsListening] = useState(false);
	    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	    const listeningBaseValueRef = useRef("");

    const isBusy = isStreaming || isSubmitting;

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
            >
              <SelectTrigger
                className="prompt-input-model-select"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
