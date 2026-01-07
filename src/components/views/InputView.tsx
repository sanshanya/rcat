import { Capsule } from "@/components";
import VrmSidePanel from "@/components/vrm/VrmSidePanel";
import PromptInput from "@/components/PromptInput";
import { useChatUi } from "@/contexts/ChatUiContext";

export type InputViewProps = {
  errorText?: string | null;
};

export function InputView({ errorText }: InputViewProps) {
  const { capsuleProps, promptProps, skinMode } = useChatUi();
  return (
    <div className="flex min-h-0 w-full items-stretch gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Capsule {...capsuleProps} />
        <PromptInput {...promptProps} />
        {errorText ? (
          <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
            {errorText}
          </div>
        ) : null}
      </div>
      {skinMode === "vrm" ? <VrmSidePanel /> : null}
    </div>
  );
}

export default InputView;
