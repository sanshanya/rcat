import { createUIMessageStream, type ChatTransport, type UIMessage } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const AI_EVENTS = {
  CHAT_STREAM: "chat-stream",
  CHAT_ERROR: "chat-error",
} as const;

type TauriChatStreamPayload = {
  chunk?: string;
  delta?: string;
  kind?: "text" | "reasoning";
  done?: boolean;
};

const createPartId = () =>
  `part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Convert UIMessages to API message format
const convertMessagesToApi = (messages: UIMessage[]) => {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => ({
      role: msg.role,
      content: msg.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    }))
    .filter((msg) => msg.content.trim() !== "");
};

export const createTauriChatTransport = (): ChatTransport<UIMessage> => ({
  async sendMessages({ messages, abortSignal }) {
    return createUIMessageStream<UIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const apiMessages = convertMessagesToApi(messages);
        if (apiMessages.length === 0) {
          writer.write({ type: "error", errorText: "No messages to send." });
          return;
        }

        const textPartId = createPartId();
        const reasoningPartId = createPartId();
        let textStarted = false;
        let reasoningStarted = false;
        let finished = false;

        let unlistenStream: UnlistenFn | null = null;
        let unlistenError: UnlistenFn | null = null;

        let resolveDone: () => void = () => {};
        const donePromise = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });

        const cleanup = () => {
          unlistenStream?.();
          unlistenError?.();
          if (abortSignal) {
            abortSignal.removeEventListener("abort", handleAbort);
          }
        };

        const finish = () => {
          if (finished) return;
          finished = true;

          if (textStarted) {
            writer.write({ type: "text-end", id: textPartId });
          }

          if (reasoningStarted) {
            writer.write({ type: "reasoning-end", id: reasoningPartId });
          }

          cleanup();
          resolveDone();
        };

        const ensureTextStart = () => {
          if (textStarted) return;
          textStarted = true;
          writer.write({ type: "text-start", id: textPartId });
        };

        const ensureReasoningStart = () => {
          if (reasoningStarted) return;
          reasoningStarted = true;
          writer.write({ type: "reasoning-start", id: reasoningPartId });
        };

        const handleAbort = () => {
          writer.write({ type: "abort" });
          finish();
        };

        if (abortSignal?.aborted) {
          handleAbort();
          return;
        }

        if (abortSignal) {
          abortSignal.addEventListener("abort", handleAbort, { once: true });
        }

        unlistenStream = await listen<TauriChatStreamPayload>(
          AI_EVENTS.CHAT_STREAM,
          (event) => {
            if (event.payload.done) {
              finish();
              return;
            }

            const kind = event.payload.kind ?? "text";
            const delta = event.payload.delta ?? event.payload.chunk ?? "";
            if (!delta) return;

            if (kind === "reasoning") {
              ensureReasoningStart();
              writer.write({
                type: "reasoning-delta",
                id: reasoningPartId,
                delta,
              });
              return;
            }

            ensureTextStart();
            writer.write({
              type: "text-delta",
              id: textPartId,
              delta,
            });
          }
        );

        unlistenError = await listen<string>(AI_EVENTS.CHAT_ERROR, (event) => {
          writer.write({ type: "error", errorText: event.payload });
          finish();
        });

        void invoke("chat_stream", { messages: apiMessages }).catch((error) => {
          writer.write({ type: "error", errorText: String(error) });
          finish();
        });

        await donePromise;
      },
    });
  },
  async reconnectToStream() {
    return null;
  },
});
