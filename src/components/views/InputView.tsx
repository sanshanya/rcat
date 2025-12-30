import { Capsule } from "@/components";
import PromptInput from "@/components/PromptInput";
import { useChatUi } from "@/contexts/ChatUiContext";

export type InputViewProps = {
  errorText?: string | null;
};

export function InputView({ errorText }: InputViewProps) {
  const { capsuleProps, promptProps } = useChatUi();
  return (
    <>
      <Capsule {...capsuleProps} />
      <PromptInput {...promptProps} />
      {errorText ? (
        <div className="rounded-md border border-red-500/30 bg-red-950/35 px-3 py-2 text-xs text-red-100/90">
          {errorText}
        </div>
      ) : null}
    </>
  );
}

export default InputView;
