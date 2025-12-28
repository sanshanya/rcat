import type { UIMessage } from "ai";
import { CheckIcon, CopyIcon, PencilIcon, XIcon } from "lucide-react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";

import { getMessageText } from "./messageText";

type UserMessageProps = {
  message: UIMessage;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onConfirmEditing: () => void;
  onCopy: () => void;
  isCopied: boolean;
  canEdit: boolean;
};

export default function UserMessage({
  message,
  isEditing,
  editText,
  onEditTextChange,
  onStartEditing,
  onCancelEditing,
  onConfirmEditing,
  onCopy,
  isCopied,
  canEdit,
}: UserMessageProps) {
  return (
    <Message from="user">
      <MessageContent className="select-text">
        {isEditing ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-slate-400 focus:outline-none"
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onConfirmEditing();
                } else if (e.key === "Escape") {
                  onCancelEditing();
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-1">
              <MessageAction
                label="Cancel"
                tooltip="Cancel (Esc)"
                onClick={onCancelEditing}
              >
                <XIcon className="size-3" />
              </MessageAction>
              <MessageAction
                label="Confirm"
                tooltip="Confirm (Enter)"
                onClick={onConfirmEditing}
              >
                <CheckIcon className="size-3" />
              </MessageAction>
            </div>
          </div>
        ) : (
          <span className="select-text">{getMessageText(message)}</span>
        )}
      </MessageContent>

      {!isEditing && (
        <MessageActions>
          <MessageAction
            label="Copy"
            tooltip={isCopied ? "Copied!" : "Copy to clipboard"}
            onClick={onCopy}
          >
            {isCopied ? (
              <CheckIcon className="size-3 text-green-400" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </MessageAction>
          {canEdit && (
            <MessageAction
              label="Edit"
              tooltip="Edit and resend"
              onClick={onStartEditing}
            >
              <PencilIcon className="size-3" />
            </MessageAction>
          )}
        </MessageActions>
      )}
    </Message>
  );
}

