import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Plus, Trash2, Settings } from "lucide-react";
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

// Available models - hardcoded for now
const MODELS = [
  { id: "deepseek-reasoner", name: "DeepSeek R1" },
  { id: "deepseek-chat", name: "DeepSeek V3" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
];

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

export const PromptInput = ({
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
}: PromptInputProps) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const isBusy = isStreaming || isSubmitting;

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming && onStop) {
      onStop();
    } else if (value.trim() && !isBusy) {
      onSubmit();
    }
  };

  // Speech recognition setup
  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      onChange(value + transcript);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
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
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return (
    <form className="prompt-input-container" onSubmit={handleSubmit}>
      {/* Text input - textarea for multiline support */}
      <textarea
        ref={inputRef}
        className="prompt-input-field"
        placeholder="Say something..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Auto-resize
          e.target.style.height = 'auto';
          e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
        }}
        onKeyDown={(e) => {
          // Enter to submit, Shift+Enter for newline
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) {
              handleSubmit(e as unknown as React.FormEvent);
            }
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={disabled}
        rows={1}
      />

      {/* Toolbar */}
      <div className="prompt-input-toolbar">
        {/* Left side: extras, voice, model */}
        <div className="prompt-input-tools">
          {/* Extras button (+) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="prompt-input-tool-btn"
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

          {/* Voice button */}
          <button
            type="button"
            className={`prompt-input-tool-btn ${isListening ? "active" : ""}`}
            onClick={toggleListening}
            onPointerDown={(e) => e.stopPropagation()}
            title={isListening ? "停止录音" : "语音输入"}
          >
            {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>

          {/* Model selector */}
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger
              className="prompt-input-model-select"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Right side: submit/stop */}
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
};

export default PromptInput;
