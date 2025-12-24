"use client";

import { cn } from "@/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useState, type HTMLAttributes } from "react";

export type ThinkingIndicatorProps = HTMLAttributes<HTMLDivElement> & {
  isThinking?: boolean;
};

export const ThinkingIndicator = ({
  isThinking = true,
  className,
  ...props
}: ThinkingIndicatorProps) => {
  const [startTime] = useState(() => Date.now());
  const [duration, setDuration] = useState(0);
  const [isOpen, setIsOpen] = useState(true);

  // Update duration while thinking
  useEffect(() => {
    if (isThinking) {
      const interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isThinking, startTime]);

  const thinkingMessage = duration > 0 ? `Thinking... ${duration}s` : "Thinking...";

  return (
    <div
      className={cn("w-full", className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm",
          "bg-muted/50 hover:bg-muted transition-colors",
          "text-muted-foreground"
        )}
      >
        <div className="flex items-center gap-2">
          <BrainIcon className="h-4 w-4" />
          <span className="font-medium">{thinkingMessage}</span>
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        </div>
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      {isOpen && (
        <div className="pt-2 text-sm text-muted-foreground">
          <div className="rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <span className="thinking-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingIndicator;
