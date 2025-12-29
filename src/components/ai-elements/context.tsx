"use client";

import type { LanguageModelUsage } from "ai";
import { Gauge } from "lucide-react";
import type { HTMLAttributes } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const formatCompact = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
};

const safeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const getUsageNumbers = (usage: Partial<LanguageModelUsage>) => {
  const inputTokens = safeNumber(usage.inputTokens);
  const outputTokens = safeNumber(usage.outputTokens);
  const reasoningTokens = safeNumber(
    usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens
  );

  const textTokens = safeNumber(
    usage.outputTokenDetails?.textTokens ??
      (outputTokens ? Math.max(0, outputTokens - reasoningTokens) : 0)
  );

  const totalTokens = safeNumber(usage.totalTokens) || inputTokens + outputTokens;

  const cacheReadTokens = safeNumber(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWriteTokens = safeNumber(usage.inputTokenDetails?.cacheWriteTokens);

  return {
    inputTokens,
    outputTokens,
    textTokens,
    reasoningTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
};

export type ContextUsageIndicatorProps = HTMLAttributes<HTMLDivElement> & {
  usage: Partial<LanguageModelUsage> | null | undefined;
  maxTokens?: number | null;
  maxOutputTokens?: number | null;
  estimated?: boolean;
  disabled?: boolean;
};

export const ContextUsageIndicator = ({
  usage,
  maxTokens,
  maxOutputTokens,
  estimated = false,
  disabled = false,
  className,
  ...props
}: ContextUsageIndicatorProps) => {
  const numbers = getUsageNumbers(usage ?? {});
  const max = typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : null;
  const percent = max ? clamp((numbers.totalTokens / max) * 100, 0, 999) : null;

  const percentLabel = percent === null ? formatCompact(numbers.totalTokens) : `${Math.round(percent)}%`;
  const barWidth = percent === null ? 0 : clamp(percent, 0, 100);
  const barClass =
    percent !== null && percent >= 90
      ? "bg-red-500"
      : percent !== null && percent >= 75
        ? "bg-amber-500"
        : "bg-blue-500";

  const outputLimit =
    typeof maxOutputTokens === "number" && maxOutputTokens > 0 ? maxOutputTokens : null;
  const showReasoning = numbers.reasoningTokens > 0;

  const trigger = (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2",
        "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50"
      )}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      title="上下文使用量"
    >
      <Gauge className="size-4" />
      <span className="text-xs tabular-nums">{percentLabel}</span>
    </button>
  );

  return (
    <div className={cn("shrink-0", className)} {...props}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-72 p-2">
          <div className="flex items-center justify-between px-1 py-1.5">
            <div className="text-xs font-semibold text-slate-100">
              Context{estimated ? " (≈)" : ""}
            </div>
            <div className="text-[11px] tabular-nums text-slate-300">
              {formatCompact(numbers.totalTokens)}
              {max ? ` / ${formatCompact(max)}` : ""}
            </div>
          </div>

          {max ? (
            <div className="mb-2 mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className={cn("h-full", barClass)}
                style={{ width: `${barWidth}%` }}
              />
            </div>
          ) : null}

          <div className="grid gap-1 px-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Input</span>
              <span className="tabular-nums text-slate-100">
                {formatCompact(numbers.inputTokens)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-300">Output</span>
              <span className="tabular-nums text-slate-100">
                {formatCompact(numbers.outputTokens)}
                {outputLimit ? ` / ${formatCompact(outputLimit)}` : ""}
              </span>
            </div>

            {showReasoning ? (
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Reasoning</span>
                <span className="tabular-nums text-slate-100">
                  {formatCompact(numbers.reasoningTokens)}
                </span>
              </div>
            ) : null}

            {numbers.cacheReadTokens > 0 || numbers.cacheWriteTokens > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Cache</span>
                <span className="tabular-nums text-slate-100">
                  {formatCompact(numbers.cacheReadTokens + numbers.cacheWriteTokens)}
                </span>
              </div>
            ) : null}
          </div>

          <DropdownMenuSeparator className="my-2" />

          <div className="flex items-center justify-between px-1 pb-0.5 text-xs">
            <span className="text-slate-300">Total</span>
            <span className="tabular-nums font-semibold text-slate-100">
              {formatCompact(numbers.totalTokens)}
            </span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default ContextUsageIndicator;
