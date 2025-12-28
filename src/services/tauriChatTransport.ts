import { createUIMessageStream, type ChatTransport, type UIMessage } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EVT_CHAT_ERROR, EVT_CHAT_STREAM } from "@/constants";
import { isTauriContext, reportPromiseError } from "@/utils";

type TauriChatTransportOptions = {
  getModel?: () => string;
  getToolMode?: () => boolean;
  getConversationId?: () => string | undefined;
  onRequestCreated?: (meta: { requestId: string; conversationId?: string }) => void;
};

type TauriChatStreamPayload = {
  requestId: string;
  delta: string;
  kind: "text" | "reasoning";
  done: boolean;
};

type TauriChatErrorPayload = {
  requestId: string;
  error: string;
};

const createPartId = () =>
  `part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createRequestId = () =>
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

// Convert UIMessages to API message format
const convertMessagesToApi = (messages: UIMessage[]) => {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => ({
      role: msg.role,
      content: msg.parts
        .filter(
          (part): part is { type: "text"; text: string } => part.type === "text"
        )
        .map((part) => part.text)
        .join("\n"),
    }))
    .filter((msg) => msg.content.trim() !== "");
};

export const createTauriChatTransport = (
  options: TauriChatTransportOptions = {}
): ChatTransport<UIMessage> => ({
  async sendMessages({ messages, abortSignal }) {
    return createUIMessageStream<UIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const apiMessages = convertMessagesToApi(messages);
        if (apiMessages.length === 0) {
          writer.write({ type: "error", errorText: "No messages to send." });
          return;
        }

        if (!isTauriContext()) {
          writer.write({
            type: "error",
            errorText: "Not running in a Tauri context.",
          });
          return;
        }

        const requestId = createRequestId();

        const model = options.getModel?.();
        const conversationId = options.getConversationId?.();

        options.onRequestCreated?.({ requestId, conversationId });

        const textPartId = createPartId();
        const reasoningPartId = createPartId();
        let textStarted = false;
        let reasoningStarted = false;
        let finished = false;

        let unlistenStream: UnlistenFn | null = null;
        let unlistenError: UnlistenFn | null = null;

        let resolveDone: () => void = () => { };
        const donePromise = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });

        const cleanup = () => {
          if (unlistenStream) {
            unlistenStream();
            unlistenStream = null;
          }
          if (unlistenError) {
            unlistenError();
            unlistenError = null;
          }
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
          void invoke("chat_abort", { requestId }).catch(
            reportPromiseError("chat_abort", { onceKey: "chat_abort" })
          );
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
          EVT_CHAT_STREAM,
          (event) => {
            if (event.payload.requestId !== requestId) return;

            if (event.payload.done) {
              finish();
              return;
            }

            const delta = event.payload.delta ?? "";
            if (!delta) return;

            if (event.payload.kind === "reasoning") {
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

        unlistenError = await listen<TauriChatErrorPayload>(
          EVT_CHAT_ERROR,
          (event) => {
            if (event.payload.requestId !== requestId) return;
            writer.write({ type: "error", errorText: event.payload.error });
            finish();
          }
        );

        const invokeParams: Record<string, unknown> = {
          requestId,
          messages: apiMessages,
        };
        if (model) invokeParams.model = model;
        if (conversationId) invokeParams.conversationId = conversationId;

        // Choose the appropriate command based on tool mode
        const useTools = options.getToolMode?.() ?? false;
        const commandName = useTools ? 'chat_stream_with_tools' : 'chat_stream';

        void invoke(commandName, invokeParams).catch((error) => {
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
