import type { AiProvider } from "@/types";
import { cn } from "@/lib/utils";

import deepseekSvg from "../../../deepseek-color.svg?raw";
import openaiSvg from "../../../openai.svg?raw";
import vercelSvg from "../../../vercel.svg?raw";

export type ProviderLogoProps = {
  provider: AiProvider;
  className?: string;
  title?: string;
};

const PROVIDER_SVGS: Record<AiProvider, string> = {
  deepseek: deepseekSvg,
  openai: openaiSvg,
  compatible: vercelSvg,
};

export function ProviderLogo({ provider, className, title }: ProviderLogoProps) {
  const a11yProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };

  return (
    <span
      className={cn("inline-flex [&>svg]:h-full [&>svg]:w-full [&>svg]:block", className)}
      dangerouslySetInnerHTML={{ __html: PROVIDER_SVGS[provider] }}
      {...a11yProps}
    />
  );
}

export default ProviderLogo;
