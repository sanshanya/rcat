import { act, render } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { UIMessage } from "ai";

import ChatMessages from "@/components/ChatMessages";

const makeMessage = (id: string, role: UIMessage["role"], text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

const setScrollMetrics = (
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop?: number }
) => {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  if (typeof metrics.scrollTop === "number") {
    el.scrollTop = metrics.scrollTop;
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatMessages scroll behavior", () => {
  it("keeps pinned to bottom while streaming updates", () => {
    vi.useFakeTimers();
    const messages: UIMessage[] = [
      makeMessage("u1", "user", "Hello"),
      makeMessage("a1", "assistant", "Hi there"),
    ];

    const { getByTestId, rerender } = render(
      <ChatMessages messages={messages} status="ready" />
    );

    const scroller = getByTestId("chat-scroll");
    setScrollMetrics(scroller, { scrollHeight: 400, clientHeight: 200, scrollTop: 200 });

    const nextMessages = [
      ...messages,
      makeMessage("u2", "user", "Tell me more"),
      makeMessage("a2", "assistant", "Streaming..."),
    ];

    rerender(<ChatMessages messages={nextMessages} status="streaming" />);
    setScrollMetrics(scroller, { scrollHeight: 600, clientHeight: 200 });

    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTop).toBe(400);
  });

  it("forces scroll to bottom on conversation switch", () => {
    vi.useFakeTimers();
    const messages: UIMessage[] = [
      makeMessage("u1", "user", "Hello"),
      makeMessage("a1", "assistant", "Hi there"),
    ];

    const { getByTestId, rerender } = render(
      <ChatMessages conversationId="conv-a" messages={messages} status="ready" />
    );

    const scroller = getByTestId("chat-scroll");
    setScrollMetrics(scroller, { scrollHeight: 500, clientHeight: 200, scrollTop: 40 });

    rerender(
      <ChatMessages conversationId="conv-b" messages={messages} status="streaming" />
    );
    setScrollMetrics(scroller, { scrollHeight: 520, clientHeight: 200 });

    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTop).toBe(320);
  });
});
