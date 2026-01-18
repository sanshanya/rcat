export type AvatarBehaviorEvent =
  | { type: "speechStart"; turnId: number; timeMs: number }
  | { type: "speechEnd"; turnId: number; timeMs: number };

const queue: AvatarBehaviorEvent[] = [];

export const pushAvatarBehaviorEvent = (event: AvatarBehaviorEvent) => {
  queue.push(event);
  if (queue.length > 64) {
    queue.splice(0, queue.length - 64);
  }
};

export const drainAvatarBehaviorEvents = () => {
  if (queue.length === 0) return [];
  const events = queue.slice();
  queue.length = 0;
  return events;
};

export const clearAvatarBehaviorEvents = () => {
  queue.length = 0;
};

