import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ConversationDetail, ConversationSummary } from "@/types";
import { useConversationHistory } from "@/hooks/useConversationHistory";

const historyBootstrap = vi.fn();
const historyGetConversationPage = vi.fn();
const historyDeleteConversation = vi.fn();

vi.mock("@/services/history", () => ({
  historyBootstrap,
  historyGetConversationPage,
  historyDeleteConversation,
  historyListConversations: vi.fn(),
  historySetActiveConversation: vi.fn(),
  historyNewConversation: vi.fn(),
  historyForkConversation: vi.fn(),
  historyMarkSeen: vi.fn(),
  historyClearConversation: vi.fn(),
  historyRenameConversation: vi.fn(),
}));

vi.mock("@/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils")>();
  return {
    ...actual,
    isTauriContext: () => true,
  };
});

const buildSummary = (id: string, isActive = false): ConversationSummary => ({
  id,
  title: id,
  titleAuto: false,
  createdAtMs: 0,
  updatedAtMs: 0,
  lastSeenAtMs: 0,
  messageCount: 1,
  lastMessageAtMs: 0,
  lastRole: "assistant",
  hasUnseen: false,
  isActive,
});

const buildDetail = (summary: ConversationSummary): ConversationDetail => ({
  conversation: summary,
  messages: [
    {
      id: `${summary.id}:1`,
      conversationId: summary.id,
      seq: 1,
      role: "assistant",
      content: "Hi",
      reasoning: null,
      createdAtMs: 0,
    },
  ],
});

beforeEach(() => {
  historyBootstrap.mockReset();
  historyGetConversationPage.mockReset();
  historyDeleteConversation.mockReset();
});

describe("useConversationHistory", () => {
  it("keeps active conversation when deleting a non-active one", async () => {
    const convA = buildSummary("conv-a", true);
    const convB = buildSummary("conv-b", false);

    historyBootstrap.mockResolvedValue({
      activeConversationId: convA.id,
      conversations: [convA, convB],
    });
    historyGetConversationPage.mockImplementation(async (id: string) => {
      return buildDetail(id === convA.id ? convA : convB);
    });
    historyDeleteConversation.mockResolvedValue({
      activeConversationId: convA.id,
      conversations: [convA],
    });

    const { result } = renderHook(() => useConversationHistory());

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });
    expect(result.current.activeConversationId).toBe(convA.id);

    await act(async () => {
      await result.current.deleteConversation(convB.id);
    });

    expect(result.current.activeConversationId).toBe(convA.id);
  });
});
