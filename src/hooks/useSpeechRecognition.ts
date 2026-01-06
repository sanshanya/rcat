import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { EVT_VOICE_ASR_RESULT, EVT_VOICE_CONVERSATION_STATE } from "@/constants";
import { isTauriContext } from "@/utils";
import { voiceConversationStart, voiceConversationStop } from "@/services/voice";

type SpeechRecognitionResultLike = {
  0: { transcript: string };
  isFinal: boolean;
  length: number;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type UseSpeechRecognitionOptions = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  lang?: string;
  conversationId?: string | null;
  onFinal?: (text: string) => void;
};

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === "undefined") return null;

  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function useSpeechRecognition({
  value,
  onChange,
  disabled = false,
  lang = "zh-CN",
  conversationId = null,
  onFinal,
}: UseSpeechRecognitionOptions) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningBaseValueRef = useRef("");
  const unlistenAsrRef = useRef<UnlistenFn | null>(null);
  const unlistenStateRef = useRef<UnlistenFn | null>(null);

  const onChangeRef = useRef(onChange);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const cleanupTauriListeners = useCallback(() => {
    if (unlistenAsrRef.current) {
      unlistenAsrRef.current();
      unlistenAsrRef.current = null;
    }
    if (unlistenStateRef.current) {
      unlistenStateRef.current();
      unlistenStateRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    if (isTauriContext()) {
      void voiceConversationStop().catch(() => {});
      cleanupTauriListeners();
      setIsListening(false);
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [cleanupTauriListeners]);

  const startListening = useCallback(() => {
    if (isTauriContext()) {
      void (async () => {
        try {
          if (!unlistenAsrRef.current) {
            unlistenAsrRef.current = await listen<{
              text: string;
              turnText: string;
              start?: number | null;
              end?: number | null;
              isFinal: boolean;
            }>(EVT_VOICE_ASR_RESULT, (event) => {
              const payload = event.payload;
              const turnText = payload.turnText ?? "";
              if (!payload.isFinal) {
                onChangeRef.current(`${listeningBaseValueRef.current}${turnText}`);
                return;
              }

              const finalText = turnText.trim();
              if (finalText) {
                onFinalRef.current?.(finalText);
              }
              listeningBaseValueRef.current = "";
            });
          }

          if (!unlistenStateRef.current) {
            unlistenStateRef.current = await listen<{
              state: string;
              error?: string | null;
            }>(EVT_VOICE_CONVERSATION_STATE, (event) => {
              if (event.payload.state === "idle") {
                setIsListening(false);
              }
            });
          }

          listeningBaseValueRef.current = value;
          await voiceConversationStart(conversationId);
          setIsListening(true);
        } catch (error) {
          console.error("voice conversation start failed:", error);
          stopListening();
        }
      })();
      return;
    }

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) {
          finalTranscript += text;
        } else {
          interimTranscript += text;
        }
      }
      onChangeRef.current(
        `${listeningBaseValueRef.current}${finalTranscript}${interimTranscript}`
      );
    };

    recognition.onerror = (event: { error: string }) => {
      console.error("Speech recognition error:", event.error);
      stopListening();
    };

    recognition.onend = () => {
      stopListening();
    };

    recognitionRef.current = recognition;
    listeningBaseValueRef.current = value;
    recognition.start();
    setIsListening(true);
  }, [conversationId, lang, stopListening, value]);

  const toggleListening = useCallback(() => {
    if (disabled) return;
    if (isListening) {
      stopListening();
      return;
    }
    startListening();
  }, [disabled, isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  useEffect(() => {
    if (!disabled) return;
    if (!isListening) return;
    stopListening();
  }, [disabled, isListening, stopListening]);

  useEffect(() => {
    if (!isTauriContext()) return;
    if (!isListening) return;
    void voiceConversationStart(conversationId).catch(() => {});
  }, [conversationId, isListening]);

  return {
    isSupported:
      isTauriContext() || getSpeechRecognitionConstructor() !== null,
    isListening,
    toggleListening,
    stopListening,
  };
}

