// src/hooks/useChatSession.ts
import { useState, useRef, useCallback } from 'react';
import type { Message } from '../types';

// Re-export Message type for convenience
export type { Message };

/**
 * Hook to manage chat session state (messages, streaming, thinking).
 * Includes AbortController for canceling streaming requests.
 */
export function useChatSession() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const streamInterval = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Add a user message and start AI response
   */
  const sendMessage = useCallback((content: string) => {
    if (!content.trim()) return;
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content }]);
    setIsThinking(true);
    
    // Simulate thinking delay (will be replaced with real API call)
    setTimeout(() => {
      setIsThinking(false);
      startStreaming(content);
    }, 800);
  }, []);

  /**
   * Start streaming AI response (simulated for now)
   */
  const startStreaming = useCallback((promptText: string) => {
    // TODO: Replace with real API call in Phase 3
    const targetText = `这是针对 "**${promptText}**" 的回复。\nRust + Tauri + React **真是太棒了**！\n\n\`\`\`rust\nfn main() {\n    println!("Hello, World!");\n}\n\`\`\`\n\n组件化重构后，代码更清晰了！`;
    let currentIndex = 0;

    if (streamInterval.current) clearInterval(streamInterval.current);
    
    // Add empty AI message
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
   * Retry (regenerate) AI response from a specific message index.
   * If index is omitted, retries the last AI message.
   */
  const retryMessage = useCallback((index?: number) => {
    if (isThinking || isStreaming) return;
    
    const targetIndex = index !== undefined ? index : messages.length - 1;
    
    // Safety checks
    if (targetIndex < 0 || targetIndex >= messages.length) return;
    if (messages[targetIndex].role !== 'ai') return;
    
    // Get the user prompt that generated this response
    const promptIndex = targetIndex - 1;
    if (promptIndex < 0) return;
    
    const userPrompt = messages[promptIndex].content;
    if (!userPrompt) return;
    
    // Rewind history and regenerate
    setMessages(prev => prev.slice(0, targetIndex));
    setIsThinking(true);
    
    setTimeout(() => {
      setIsThinking(false);
      startStreaming(userPrompt);
    }, 800);
  }, [messages, isThinking, isStreaming, startStreaming]);

  /**
   * Cancel ongoing streaming (useful for AI integration)
   */
  const cancelStream = useCallback(() => {
    // Abort any in-flight fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Clear simulation interval
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
