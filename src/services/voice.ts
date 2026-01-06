import { invoke } from "@tauri-apps/api/core";

import { isTauriContext } from "@/utils";

export type VoiceConversationStatus = {
  running: boolean;
  state: string;
  lastError?: string | null;
};

export const voicePlayText = async (text: string): Promise<void> => {
  if (!isTauriContext()) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  await invoke("voice_play_text", { text: trimmed });
};

export const voiceStop = async (): Promise<void> => {
  if (!isTauriContext()) return;
  await invoke("voice_stop");
};

export const voicePrepare = async (): Promise<void> => {
  if (!isTauriContext()) return;
  await invoke("voice_prepare");
};

export const voiceConversationStart = async (
  conversationId?: string | null
): Promise<void> => {
  if (!isTauriContext()) return;
  await invoke("voice_conversation_start", {
    conversationId: conversationId ?? undefined,
  });
};

export const voiceConversationStop = async (): Promise<void> => {
  if (!isTauriContext()) return;
  await invoke("voice_conversation_stop");
};

export const voiceConversationStatus =
  async (): Promise<VoiceConversationStatus | null> => {
    if (!isTauriContext()) return null;
    return await invoke("voice_conversation_status");
  };
