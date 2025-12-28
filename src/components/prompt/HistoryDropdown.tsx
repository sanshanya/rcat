import { useEffect, useRef, useState } from "react";
import { Clock3, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationSummary } from "@/types";

type HistoryDropdownProps = {
  disabled?: boolean;
  conversations: ConversationSummary[];
  activeConversationId?: string | null;
  hasNotification?: boolean;
  onSelectConversation?: (conversationId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
};

export function HistoryDropdown({
  disabled = false,
  conversations,
  activeConversationId,
  hasNotification = false,
  onSelectConversation,
  onDeleteConversation,
}: HistoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const filtered = conversations.filter((c) => c.messageCount > 0);

  useEffect(() => {
    if (!open) return;
    const el = contentRef.current;
    if (!el) return;

    const raf = requestAnimationFrame(() => {
      if (!activeConversationId) {
        el.scrollTop = el.scrollHeight;
        return;
      }

      const activeItem = el.querySelector<HTMLElement>(
        `[data-conversation-id="${activeConversationId}"]`
      );
      if (activeItem) {
        activeItem.scrollIntoView({ block: "nearest" });
        return;
      }
      el.scrollTop = el.scrollHeight;
    });

    return () => cancelAnimationFrame(raf);
  }, [activeConversationId, filtered.length, open]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50"
          )}
          disabled={disabled}
          onPointerDown={(e) => e.stopPropagation()}
          title="历史记录"
        >
          <Clock3 className="size-4" />
          {hasNotification && (
            <span className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500 shadow" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        ref={contentRef}
        side="bottom"
        align="start"
        sideOffset={4}
        className="overflow-y-auto overscroll-contain"
      >
        <DropdownMenuLabel>历史记录</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {filtered.length === 0 ? (
          <DropdownMenuItem disabled>暂无历史</DropdownMenuItem>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((c) => (
              <div
                key={c.id}
                data-conversation-id={c.id}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs",
                  "text-slate-200 transition-colors",
                  c.id === activeConversationId ? "bg-slate-700" : "hover:bg-slate-700"
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "-ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm",
                    "text-slate-300 hover:bg-slate-600 hover:text-slate-50",
                    "disabled:opacity-40"
                  )}
                  disabled={!onDeleteConversation}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteConversation?.(c.id);
                  }}
                  title="删除对话"
                >
                  <Trash2 className="size-4" />
                </button>

                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    onSelectConversation?.(c.id);
                    setOpen(false);
                  }}
                  title={c.title}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {c.hasUnseen && c.id !== activeConversationId && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 shadow" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
