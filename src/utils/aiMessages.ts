import type { UIMessage } from "ai";

import type { ConversationDetail } from "@/types";

export const getMessageText = (message: UIMessage): string => {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
};

export const conversationDetailToUiMessages = (
  detail: ConversationDetail
): UIMessage[] => {
  return detail.messages.map((m) => {
    const parts: any[] = [];
    if (m.role === "assistant" && m.reasoning) {
      parts.push({ type: "reasoning", text: String(m.reasoning) });
    }
    if (m.content) {
      parts.push({ type: "text", text: m.content });
    }
    return { id: m.id, role: m.role as UIMessage["role"], parts } as UIMessage;
  });
};

