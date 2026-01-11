export type EmotionId =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "shy"
  | "surprised"
  | "anxious"
  | "confused";

export type EmotionOption = {
  id: EmotionId;
  label: string;
};

export const EMOTION_OPTIONS: EmotionOption[] = [
  { id: "neutral", label: "Neutral" },
  { id: "happy", label: "Happy" },
  { id: "sad", label: "Sad" },
  { id: "angry", label: "Angry" },
  { id: "shy", label: "Shy" },
  { id: "surprised", label: "Surprised" },
  { id: "anxious", label: "Anxious" },
  { id: "confused", label: "Confused" },
];

