import { invoke } from "@tauri-apps/api/core";

import type {
  ConversationDetail,
  ConversationSummary,
  HistoryBootstrap,
} from "@/types";

export const historyBootstrap = () =>
  invoke<HistoryBootstrap>("history_bootstrap");

export const historyListConversations = () =>
  invoke<ConversationSummary[]>("history_list_conversations");

export const historyGetConversation = (conversationId: string) =>
  invoke<ConversationDetail>("history_get_conversation", { conversationId });

export const historyNewConversation = () =>
  invoke<ConversationSummary>("history_new_conversation");

export const historySetActiveConversation = (conversationId: string) =>
  invoke<void>("history_set_active_conversation", { conversationId });

export const historyMarkSeen = (conversationId: string) =>
  invoke<void>("history_mark_seen", { conversationId });

export const historyClearConversation = (conversationId: string) =>
  invoke<void>("history_clear_conversation", { conversationId });

export const historyDeleteConversation = (conversationId: string) =>
  invoke<HistoryBootstrap>("history_delete_conversation", { conversationId });
