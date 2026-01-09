import { useEffect, useRef } from "react";
import type { ChatTransport, UIMessage } from "ai";

import { createTauriChatTransport } from "@/services";

type UseChatTransportOptions = {
  model?: string | null;
  toolMode?: boolean;
  voiceMode?: boolean;
  conversationId?: string;
  onRequestCreated?: (meta: { requestId: string; conversationId?: string }) => void;
};

export const useChatTransport = (
  options: UseChatTransportOptions
): ChatTransport<UIMessage> => {
  const modelRef = useRef<string | undefined>(options.model ?? undefined);
  const toolModeRef = useRef<boolean>(options.toolMode ?? false);
  const voiceModeRef = useRef<boolean>(options.voiceMode ?? false);
  const conversationIdRef = useRef<string | undefined>(options.conversationId);
  const onRequestCreatedRef = useRef<UseChatTransportOptions["onRequestCreated"]>(
    options.onRequestCreated
  );

  useEffect(() => {
    modelRef.current = options.model ?? undefined;
  }, [options.model]);

  useEffect(() => {
    toolModeRef.current = options.toolMode ?? false;
  }, [options.toolMode]);

  useEffect(() => {
    voiceModeRef.current = options.voiceMode ?? false;
  }, [options.voiceMode]);

  useEffect(() => {
    conversationIdRef.current = options.conversationId;
  }, [options.conversationId]);

  useEffect(() => {
    onRequestCreatedRef.current = options.onRequestCreated;
  }, [options.onRequestCreated]);

  const transportRef = useRef<ChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = createTauriChatTransport({
      getModel: () => modelRef.current ?? "",
      getToolMode: () => toolModeRef.current ?? false,
      getVoiceMode: () => voiceModeRef.current ?? false,
      getConversationId: () => conversationIdRef.current,
      onRequestCreated: (meta) => onRequestCreatedRef.current?.(meta),
    });
  }

  return transportRef.current;
};
