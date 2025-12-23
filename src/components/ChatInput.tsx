import React, { forwardRef } from "react";
import { motion } from "framer-motion";

interface ChatInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  disabled: boolean;
}

const ChatInput = forwardRef<HTMLInputElement, ChatInputProps>(
  ({ value, onChange, onKeyDown, disabled }, ref) => {
    return (
      <motion.div 
        className="input-area"
        initial={{ opacity: 0, y: -20, height: 0 }}
        animate={{ opacity: 1, y: 0, height: "auto" }}
        exit={{ opacity: 0, y: -20, height: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <input
          ref={ref}
          type="text"
          className="chat-input"
          placeholder="Say something..."
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={disabled}
        />
      </motion.div>
    );
  }
);

ChatInput.displayName = "ChatInput";
export default ChatInput;
