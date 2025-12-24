"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";

// Context for sharing streaming state
type ReasoningContextType = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  startTime: number | null;
};

const ReasoningContext = createContext<ReasoningContextType | null>(null);

const useReasoningContext = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within <Reasoning>");
  }
  return context;
};

// Main Reasoning container
export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export const Reasoning = ({
  isStreaming = false,
  children,
  className,
  ...props
}: ReasoningProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Auto-open when streaming starts, auto-close when streaming ends
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
      if (!startTime) {
        setStartTime(Date.now());
      }
    } else if (startTime) {
      // Auto-close after streaming ends (with delay to let user see final content)
      const timer = setTimeout(() => setIsOpen(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, startTime]);

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen, setIsOpen, startTime }}>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className={cn("w-full", className)}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
};

// Reasoning Trigger
export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title?: string;
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

export const ReasoningTrigger = ({
  title = "Reasoning",
  getThinkingMessage,
  className,
  ...props
}: ReasoningTriggerProps) => {
  const { isStreaming, isOpen, startTime } = useReasoningContext();
  const [duration, setDuration] = useState(0);

  // Update duration while streaming
  useEffect(() => {
    if (isStreaming && startTime) {
      const interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isStreaming, startTime]);

  const defaultThinkingMessage = (streaming: boolean, dur?: number) => {
    if (streaming) {
      return dur && dur > 0 ? `Thinking... (${dur}s)` : "Thinking...";
    }
    return dur && dur > 0 ? `Thought for ${dur}s` : "Finished thinking";
  };

  const message = getThinkingMessage
    ? getThinkingMessage(isStreaming, duration)
    : defaultThinkingMessage(isStreaming, duration);

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm",
        "bg-muted/50 hover:bg-muted transition-colors",
        "text-muted-foreground",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{title}</span>
        <span className="text-xs opacity-70">{message}</span>
        {isStreaming && (
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        )}
      </div>
      <ChevronDownIcon
        className={cn(
          "h-4 w-4 transition-transform duration-200",
          isOpen && "rotate-180"
        )}
      />
    </CollapsibleTrigger>
  );
};

// Reasoning Content
export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children?: string;
};

export const ReasoningContent = ({
  children,
  className,
  ...props
}: ReasoningContentProps) => {
  const { isStreaming } = useReasoningContext();

  return (
    <CollapsibleContent
      className={cn("pt-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      <div className="rounded-md border border-border/50 bg-muted/30 p-3">
        <Streamdown
          isAnimating={isStreaming}
          shikiTheme={["github-dark", "github-dark"]}
        >
          {children || ""}
        </Streamdown>
      </div>
    </CollapsibleContent>
  );
};
