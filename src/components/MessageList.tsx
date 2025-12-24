import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MarkdownRenderer from "./MarkdownRenderer";
import type { Message } from "../types";

interface MessageListProps {
    messages: Message[];
    isThinking: boolean;
    isStreaming: boolean;
    onRetry?: (index: number) => void;
}

const MessageList = ({ messages, isThinking, isStreaming, onRetry }: MessageListProps) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const userScrolledUp = useRef(false);

    // Auto-scroll logic with ResizeObserver for robustness
    useEffect(() => {
        // ... (logic remains same)
        if (!scrollRef.current) return;

        // Create an observer to watch for content size changes
        const observer = new ResizeObserver(() => {
            if (!userScrolledUp.current && scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        });

        observer.observe(scrollRef.current);

        if (!userScrolledUp.current) {
            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            });
        }

        return () => observer.disconnect();
    }, [messages, isThinking]);

    // ... (handleScroll remains same)
    const handleScroll = () => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        userScrolledUp.current = !isAtBottom;
    };

    return (
        <motion.div
            className="result-area"
            ref={scrollRef}
            onScroll={handleScroll}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
        >
            <AnimatePresence initial={false} mode="popLayout">
                {messages.map((msg, index) => (
                    <motion.div
                        key={index}
                        className={`message ${msg.role}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                        layout
                    >
                        <span className="message-role">{msg.role === 'user' ? '你' : 'AI'}</span>
                        <div className="message-content">
                            {msg.role === 'ai' ? (
                                <MarkdownRenderer content={msg.content} />
                            ) : (
                                msg.content
                            )}
                            {/* Message Actions */}
                            {/* Show actions if: It's an AI message AND (it's not the last message OR we are not streaming) */}
                            {msg.role === 'ai' && (index !== messages.length - 1 || !isStreaming) && (
                                <motion.div
                                    className="message-actions"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    <button
                                        className="action-btn"
                                        onClick={() => navigator.clipboard.writeText(msg.content)}
                                        title="Copy full response"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                        Copy
                                    </button>
                                    <button
                                        className="action-btn"
                                        onClick={() => onRetry?.(index)}
                                        title="Regenerate from here"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>
                                        Retry
                                    </button>
                                </motion.div>
                            )}

                            {/* Cursor ... */}
                            {msg.role === 'ai' && index === messages.length - 1 && isStreaming && (
                                <motion.span
                                    className="cursor-blink"
                                    style={{ marginLeft: '4px', display: 'inline-block', width: '2px', height: '14px', backgroundColor: '#00ff88' }}
                                    animate={{ opacity: [0, 1, 0] }}
                                    transition={{ repeat: Infinity, duration: 0.8 }}
                                />
                            )}
                        </div>
                    </motion.div>
                ))}

                {isThinking && (
                    <motion.div
                        key="thinking"
                        className="message ai"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        layout
                    >
                        <span className="message-role">AI</span>
                        <span className="loading-dots">
                            <motion.span animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }}>.</motion.span>
                            <motion.span animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }}>.</motion.span>
                            <motion.span animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }}>.</motion.span>
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default MessageList;
