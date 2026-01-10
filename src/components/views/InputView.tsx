import { Capsule } from "@/components";
import PromptInput from "@/components/PromptInput";
import { useChatContext } from "@/contexts/ChatContext";
import { cn } from "@/lib/utils";

export type InputViewProps = {
  className?: string;
};

export function InputView({ className }: InputViewProps) {
  const { capsuleProps, promptProps, errorText } = useChatContext();
  return (
    <div
      className={cn(
        "flex min-h-0 w-[var(--chat-column-width)] flex-none flex-col gap-2",
        className
      )}
    >
      <Capsule {...capsuleProps} />
      <PromptInput {...promptProps} />
      {errorText ? (
        <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
          {errorText}
        </div>
      ) : null}
    </div>
  );
}

export default InputView;
