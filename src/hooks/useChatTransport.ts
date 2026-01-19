import { useMemo } from "react";
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
  const model = options.model ?? "";
  const toolMode = options.toolMode ?? false;
  const voiceMode = options.voiceMode ?? false;
  const conversationId = options.conversationId;
  const onRequestCreated = options.onRequestCreated;

  return useMemo(
    () =>
    createTauriChatTransport({
      getModel: () => model,
      getToolMode: () => toolMode,
      getVoiceMode: () => voiceMode,
      getConversationId: () => conversationId,
      onRequestCreated,
    })
    ,
    [conversationId, model, onRequestCreated, toolMode, voiceMode]
  );
};
