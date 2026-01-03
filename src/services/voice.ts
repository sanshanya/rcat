import { invoke } from "@tauri-apps/api/core";

import { isTauriContext } from "@/utils";

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
