export type AvatarPointerInputEvent = {
  type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel";
  pointerId: number;
  ndc: { x: number; y: number };
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  button: number;
  buttons: number;
  timeMs: number;
};

const queue: AvatarPointerInputEvent[] = [];

export const pushAvatarPointerInputEvent = (event: AvatarPointerInputEvent) => {
  queue.push(event);
  if (queue.length > 128) {
    queue.splice(0, queue.length - 128);
  }
};

export const drainAvatarPointerInputEvents = () => {
  if (queue.length === 0) return [];
  const events = queue.slice();
  queue.length = 0;
  return events;
};
