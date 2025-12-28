import { invoke } from "@tauri-apps/api/core";

export const chatAbortConversation = async (conversationId: string): Promise<void> => {
  await invoke("chat_abort_conversation", { conversationId });
};

