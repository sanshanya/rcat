import type { UIMessage } from "ai";

export const getMessageText = (message: UIMessage): string => {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
};

