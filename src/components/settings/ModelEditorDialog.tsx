import type { Dispatch, SetStateAction } from "react";

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ModelEditorDraft = {
  originalId: string | null;
  id: string;
  maxContext: string;
  maxOutput: string;
  supportsVision: boolean;
  supportsThink: boolean;
  special: string;
};

type ModelEditorDialogProps = {
  draft: ModelEditorDraft;
  setDraft: Dispatch<SetStateAction<ModelEditorDraft | null>>;
  errorText?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ModelEditorDialog({
  draft,
  setDraft,
  errorText,
  onCancel,
  onConfirm,
}: ModelEditorDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.target !== e.currentTarget) return;
        onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border/50 bg-background/90 p-3 shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">
            {draft.originalId ? "编辑模型" : "添加模型"}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            title="关闭"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
          <div className="grid gap-1">
            <div className="text-xs opacity-70">Model ID</div>
            <input
              className={cn(
                "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              )}
              value={draft.id}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, id: e.target.value } : prev
                )
              }
              placeholder="例如 deepseek-chat"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <div className="text-xs opacity-70">最大上下文</div>
              <input
                className={cn(
                  "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                  "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                )}
                value={draft.maxContext}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, maxContext: e.target.value } : prev
                  )
                }
                placeholder="可选"
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-1">
              <div className="text-xs opacity-70">最大输出</div>
              <input
                className={cn(
                  "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                  "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                )}
                value={draft.maxOutput}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, maxOutput: e.target.value } : prev
                  )
                }
                placeholder="可选"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-foreground/80">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={draft.supportsVision}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, supportsVision: e.target.checked } : prev
                  )
                }
              />
              支持 Vision
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground/80">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={draft.supportsThink}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, supportsThink: e.target.checked } : prev
                  )
                }
              />
              支持 Think
            </label>
          </div>

          <div className="grid gap-1">
            <div className="text-xs opacity-70">Special（可选）</div>
            <input
              className={cn(
                "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              )}
              value={draft.special}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, special: e.target.value } : prev
                )
              }
              placeholder="例如: special"
            />
          </div>

          {errorText ? (
            <div className="text-xs text-red-200/90">{errorText}</div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onCancel}
            >
              取消
            </Button>
            <Button type="button" size="sm" onClick={onConfirm}>
              确认
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
