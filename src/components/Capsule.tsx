import { useRef, type PointerEvent } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { AiProvider, WindowMode } from "@/types";
import { cn } from "@/lib/utils";
import ProviderLogo from "@/components/icons/ProviderLogo";
import { isTauriContext, reportPromiseError } from "@/utils";

interface CapsuleProps {
  isThinking: boolean;
  modelId: string;
  provider?: AiProvider | null;
  windowMode: WindowMode;
  hasNotification?: boolean;
  onClick: () => void;
  disabled: boolean;
}

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  didDrag: boolean;
} | null;

const DRAG_THRESHOLD_PX = 6;

const renderModelIcon = (
  provider: AiProvider | null | undefined,
  modelId: string,
  className?: string
) => {
  if (provider) {
    return (
      <ProviderLogo
        provider={provider}
        className={cn("select-none text-foreground/90", className)}
      />
    );
  }

  const lower = modelId.trim().toLowerCase();
  if (lower.startsWith("deepseek")) {
    return (
      <ProviderLogo
        provider="deepseek"
        className={cn("select-none text-foreground/90", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex select-none items-center justify-center rounded-full bg-white/10 text-xs font-semibold uppercase text-foreground/90",
        className
      )}
    >
      {(modelId.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
};

const Capsule = ({
  isThinking,
  modelId,
  provider,
  windowMode,
  hasNotification = false,
  onClick,
  disabled,
}: CapsuleProps) => {
  const isMini = windowMode === "mini";
  const isActive = !isMini;
  const dragStateRef = useRef<DragState>(null);
  const suppressClickRef = useRef(false);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (disabled) return;
    if (!isTauriContext()) return;

    suppressClickRef.current = false;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      didDrag: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture failures.
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.pointerId !== e.pointerId) return;
    if (state.didDrag) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    state.didDrag = true;
    suppressClickRef.current = true;
    e.preventDefault();
    e.stopPropagation();
    void getCurrentWindow().startDragging().catch(
      reportPromiseError("Capsule.startDragging", {
        onceKey: "Capsule.startDragging",
        devOnly: true,
      })
    );
  };

  const handlePointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.pointerId !== e.pointerId) return;

    dragStateRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore pointer release failures.
    }
  };

  return (
    <motion.button
      layout
      type="button"
      aria-label={isMini ? "Open" : "Ask AI"}
      className={cn(
        "relative flex h-14 shrink-0 select-none items-center rounded-full",
        isMini ? "w-14 justify-center" : "w-fit gap-2 pr-5",
        "bg-background/95 text-foreground shadow-md ring-1 ring-inset ring-white/10",
        "text-[15px] font-semibold tracking-[0.5px] transition-colors duration-200",
        isActive && "bg-muted/50",
        disabled
          ? "cursor-not-allowed border border-white/10 bg-background/80 shadow-none"
          : "cursor-pointer hover:bg-background active:scale-[0.99]"
      )}
      onClick={(e) => {
        if (disabled) return;
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick();
      }}
      onContextMenu={(e) => {
        if (disabled) return;
        if (!isTauriContext()) return;
        e.preventDefault();
        e.stopPropagation();
        void invoke("dismiss_capsule", { reason: "contextmenu" }).catch(
          reportPromiseError("Capsule.dismiss_capsule", {
            onceKey: "Capsule.dismiss_capsule",
            devOnly: true,
          })
        );
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      initial={false}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <span className="relative inline-flex h-14 w-14 items-center justify-center">
        {renderModelIcon(provider, modelId, "h-7 w-7")}
        {hasNotification && (
          <span className="pointer-events-none absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 shadow" />
        )}
      </span>

      {!isMini && (
        <motion.span layout key="label" className="whitespace-nowrap">
          {isThinking ? "Thinking..." : "Ask AI"}
        </motion.span>
      )}

      {isThinking && (
        <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-inset ring-primary/60 animate-pulse" />
      )}
    </motion.button>
  );
};

export default Capsule;
