import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStatus } from "ai";

type UseGeneratingTrackerParams = {
  activeConversationId: string | null;
  busy: boolean;
  status: ChatStatus;
};

export function useGeneratingTracker({
  activeConversationId,
  busy,
  status,
}: UseGeneratingTrackerParams) {
  const [generatingConversations, setGeneratingConversations] = useState<
    Set<string>
  >(() => new Set());
  const attachedConversationIdRef = useRef<string | null>(null);

  const markGenerating = useCallback((conversationId: string) => {
    const id = conversationId.trim();
    if (!id) return;
    setGeneratingConversations((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const clearGenerating = useCallback((conversationId: string) => {
    const id = conversationId.trim();
    if (!id) return;
    setGeneratingConversations((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isConversationGenerating = useCallback(
    (conversationId: string) => generatingConversations.has(conversationId),
    [generatingConversations]
  );

  const isActiveConversationGenerating = activeConversationId
    ? generatingConversations.has(activeConversationId)
    : false;
  const isActiveConversationDetachedGenerating =
    isActiveConversationGenerating && !busy;
  const isAnyConversationGenerating = busy || generatingConversations.size > 0;

  useEffect(() => {
    if (status !== "error") return;
    if (!activeConversationId) return;
    clearGenerating(activeConversationId);
  }, [activeConversationId, clearGenerating, status]);

  useEffect(() => {
    if (!activeConversationId) return;
    if (busy) {
      attachedConversationIdRef.current = activeConversationId;
      return;
    }

    const attachedId = attachedConversationIdRef.current;
    if (!attachedId) return;
    if (attachedId !== activeConversationId) {
      attachedConversationIdRef.current = null;
      return;
    }

    clearGenerating(attachedId);
    attachedConversationIdRef.current = null;
  }, [activeConversationId, busy, clearGenerating]);

  return {
    generatingConversations,
    isConversationGenerating,
    isActiveConversationGenerating,
    isActiveConversationDetachedGenerating,
    isAnyConversationGenerating,
    markGenerating,
    clearGenerating,
  };
}
