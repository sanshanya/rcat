import type { LanguageModelUsage, UIMessage } from "ai";

const isCjkCodePoint = (codePoint: number) =>
  // CJK Unified Ideographs + Extension A (basic coverage; good enough for estimation).
  (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
  (codePoint >= 0x4e00 && codePoint <= 0x9fff);

export const estimateTokens = (text: string): number => {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let cjk = 0;
  let other = 0;

  for (const ch of trimmed) {
    if (/\s/.test(ch)) continue;
    const codePoint = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(codePoint)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }

  // Very rough heuristic:
  // - CJK chars tend to be ~1 token
  // - ASCII-ish chars average ~4 chars/token
  return cjk + Math.ceil(other / 4);
};

type MessagePart = UIMessage["parts"][number];
type TextPart = Extract<MessagePart, { type: "text"; text: string }>;
type ReasoningPart = Extract<MessagePart, { type: "reasoning"; text: string }>;

const isTextPart = (part: MessagePart): part is TextPart =>
  part.type === "text";
const isReasoningPart = (part: MessagePart): part is ReasoningPart =>
  part.type === "reasoning";

const joinTextParts = (message: UIMessage) =>
  message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n");

const joinReasoningParts = (message: UIMessage) =>
  message.parts
    .filter(isReasoningPart)
    .map((part) => part.text)
    .join("\n");

export type EstimateUsageOptions = {
  messages: UIMessage[];
  draftText?: string;
  isGenerating?: boolean;
};

export const estimateLanguageModelUsageFromMessages = ({
  messages,
  draftText = "",
  isGenerating = false,
}: EstimateUsageOptions): LanguageModelUsage => {
  const activeAssistantId = isGenerating
    ? ([...messages].reverse().find((m) => m.role === "assistant")?.id ?? null)
    : null;

  let inputTokens = 0;
  let outputTextTokens = 0;
  let outputReasoningTokens = 0;

  for (const message of messages) {
    if (message.role === "system") continue;

    const text = joinTextParts(message);
    if (message.id === activeAssistantId) {
      outputTextTokens += estimateTokens(text);
      outputReasoningTokens += estimateTokens(joinReasoningParts(message));
    } else {
      // Prototype behavior: we only send "text" parts back to the model (no reasoning).
      inputTokens += estimateTokens(text);
    }
  }

  if (draftText.trim()) {
    inputTokens += estimateTokens(draftText);
  }

  const outputTokens = outputTextTokens + outputReasoningTokens;
  const totalTokens = inputTokens + outputTokens;

  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: outputTextTokens,
      reasoningTokens: outputReasoningTokens,
    },
    totalTokens,
  };
};
