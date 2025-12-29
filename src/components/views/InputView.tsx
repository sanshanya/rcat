import type { ComponentProps } from "react";

import { Capsule } from "@/components";
import PromptInput from "@/components/PromptInput";

export type InputViewProps = {
  capsuleProps: ComponentProps<typeof Capsule>;
  promptProps: ComponentProps<typeof PromptInput>;
  errorText?: string | null;
};

export function InputView({ capsuleProps, promptProps, errorText }: InputViewProps) {
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

