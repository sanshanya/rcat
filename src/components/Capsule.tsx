import { motion } from "framer-motion";
import type { WindowMode } from "@/types";

interface CapsuleProps {
  isThinking: boolean;
  messageCount: number;
  windowMode: WindowMode;
  onClick: () => void;
  disabled: boolean;
}

const Capsule = ({ isThinking, messageCount, windowMode, onClick, disabled }: CapsuleProps) => {
  return (
    <motion.div
      layoutId="capsule"
      className={`capsule ${windowMode !== 'mini' ? "active" : ""}`}
      onClick={!disabled ? onClick : undefined}
      initial={false}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <motion.span 
        style={{ fontSize: "18px", marginRight: "8px" }}
        key={isThinking ? "think" : messageCount > 0 ? "chat" : "idle"}
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
      >
        {isThinking ? "⏳" : (messageCount > 0 ? "💬" : (windowMode !== 'mini' ? "🤖" : "💊"))}
      </motion.span>
      <motion.span
        layout
        key="text"
      >
        {isThinking ? "Thinking..." : (windowMode !== 'mini' ? "Ask AI" : "Rust Capsule")}
      </motion.span>
    </motion.div>
  );
};

export default Capsule;
