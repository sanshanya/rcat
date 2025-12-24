// src/hooks/useChatSession.ts
import { useState, useRef, useCallback } from 'react';
import type { Message } from '../types';
import { streamChat, loadAiConfig } from '../services/ai';
import type { UnlistenFn } from '@tauri-apps/api/event';

// Re-export Message type for convenience
export type { Message };

/** Use mock streaming instead of real AI (for development) */
const USE_MOCK_AI = false;

/**
 * Hook to manage chat session state (messages, streaming, thinking).
 * Integrates with Rust backend AI service via Tauri commands.
 */
export function useChatSession() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Cleanup function for stream event listeners
  const cleanupRef = useRef<UnlistenFn | null>(null);
  // For mock streaming fallback
  const streamInterval = useRef<number | null>(null);

  /**
   * Start real AI streaming via Rust backend
   */
  const startRealStreaming = useCallback(async (promptText: string) => {
    // Clean up any previous listeners first
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    const config = await loadAiConfig();

    // Check if API key is configured
    if (!config.api_key) {
      // Fallback to mock if no API key
      console.warn('No API key configured, using mock streaming');
      startMockStreaming(promptText);
      return;
    }

    // Add empty AI message
    setMessages(prev => [...prev, { role: 'ai', content: '' }]);
    setIsStreaming(true);

    try {
      cleanupRef.current = await streamChat(promptText, config, {
        onChunk: (chunk) => {
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg?.role === 'ai') {
              newMessages[newMessages.length - 1] = {
                role: 'ai',
                content: lastMsg.content + chunk
              };
            }
            return newMessages;
          });
        },
        onDone: () => {
          setIsStreaming(false);
          cleanupRef.current = null;
        },
        onError: (error) => {
          console.error('AI streaming error:', error);
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg?.role === 'ai') {
              newMessages[newMessages.length - 1] = {
                role: 'ai',
                content: `Error: ${error}`
              };
            }
            return newMessages;
          });
          setIsStreaming(false);
          cleanupRef.current = null;
        },
      });
    } catch (error) {
      console.error('Failed to start streaming:', error);
      setIsStreaming(false);
    }
  }, []);

  /**
   * Mock streaming for development/testing
   */
  const startMockStreaming = useCallback((promptText: string) => {
    const targetText = `这是针对 "**${promptText}**" 的回复。\nRust + Tauri + React **真是太棒了**！\n\n\`\`\`rust\nfn main() {\n    println!("Hello, World!");\n}\n\`\`\`\n\n组件化重构后，代码更清晰了！`;
    let currentIndex = 0;

    if (streamInterval.current) clearInterval(streamInterval.current);

    setMessages(prev => [...prev, { role: 'ai', content: '' }]);
    setIsStreaming(true);

    streamInterval.current = window.setInterval(() => {
      currentIndex++;
      const currentText = targetText.slice(0, currentIndex);

      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = { role: 'ai', content: currentText };
        return newMessages;
      });

      if (currentIndex >= targetText.length) {
        if (streamInterval.current) clearInterval(streamInterval.current);
        setIsStreaming(false);
      }
    }, 30);
  }, []);

  /**
   * Add a user message and start AI response
   */
  const sendMessage = useCallback((content: string) => {
    if (!content.trim()) return;

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content }]);
    setIsThinking(true);

    // Brief delay to show thinking state
    setTimeout(() => {
      setIsThinking(false);
      if (USE_MOCK_AI) {
        startMockStreaming(content);
      } else {
        startRealStreaming(content);
      }
    }, 300);
  }, [startMockStreaming, startRealStreaming]);

  /**
   * Retry (regenerate) AI response from a specific message index
   */
  const retryMessage = useCallback((index?: number) => {
    if (isThinking || isStreaming) return;

    const targetIndex = index !== undefined ? index : messages.length - 1;

    if (targetIndex < 0 || targetIndex >= messages.length) return;
    if (messages[targetIndex].role !== 'ai') return;

    const promptIndex = targetIndex - 1;
    if (promptIndex < 0) return;

    const userPrompt = messages[promptIndex].content;
    if (!userPrompt) return;

    // Rewind history and regenerate
    setMessages(prev => prev.slice(0, targetIndex));
    setIsThinking(true);

    setTimeout(() => {
      setIsThinking(false);
      if (USE_MOCK_AI) {
        startMockStreaming(userPrompt);
      } else {
        startRealStreaming(userPrompt);
      }
    }, 300);
  }, [messages, isThinking, isStreaming, startMockStreaming, startRealStreaming]);

  /**
   * Cancel ongoing streaming
   */
  const cancelStream = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (streamInterval.current) {
      clearInterval(streamInterval.current);
      streamInterval.current = null;
    }
    setIsStreaming(false);
    setIsThinking(false);
  }, []);

  /**
   * Clear all messages and state
   */
  const clearSession = useCallback(() => {
    cancelStream();
    setMessages([]);
  }, [cancelStream]);

  return {
    messages,
    isThinking,
    isStreaming,
    sendMessage,
    retryMessage,
    cancelStream,
    clearSession,
  };
}
