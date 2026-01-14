import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMotionCatalog } from "@/components/vrm/motion/motionCatalog";
import { EMOTION_OPTIONS, type EmotionId } from "@/components/vrm/emotionTypes";
import type { VrmCommand, VrmStateSnapshot } from "@/windows/vrmBridgeTypes";

type VrmTabProps = {
  snapshot: VrmStateSnapshot | null;
  sendCommand: (cmd: VrmCommand) => void;
};

export default function VrmTab({ snapshot, sendCommand }: VrmTabProps) {
  const motions = useMotionCatalog();
  const [motionId, setMotionId] = useState<string>("");
  const [loop, setLoop] = useState(true);

  useEffect(() => {
    if (motions.length === 0) return;
    if (motionId && motions.some((m) => m.id === motionId)) return;
    setMotionId(motions[0].id);
    setLoop(motions[0].loop ?? true);
  }, [motionId, motions]);

  const toolMode = snapshot?.toolMode ?? "camera";
  const currentEmotion = snapshot?.emotion.id ?? "neutral";
  const currentIntensity = snapshot?.emotion.intensity ?? 1;

  const emotionOptions = useMemo(() => EMOTION_OPTIONS, []);

  const playDisabled = motions.length === 0 || !motionId;

  return (
    <div className="flex w-[min(520px,calc(100vw-24px))] flex-col gap-3 rounded-lg bg-background/60 p-3 text-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-foreground/70">VRM</div>
        <div className="flex items-center gap-2 text-[11px] text-foreground/60">
          <span>Motion:</span>
          <span className="font-mono">
            {snapshot?.motion.id ?? "none"}
            {snapshot?.motion.playing ? " (playing)" : ""}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-16 text-xs text-foreground/60">Tool</div>
        <Button
          size="sm"
          variant={toolMode === "camera" ? "default" : "secondary"}
          onClick={() => sendCommand({ type: "setToolMode", mode: "camera" })}
        >
          Camera
        </Button>
        <Button
          size="sm"
          variant={toolMode === "avatar" ? "default" : "secondary"}
          onClick={() => sendCommand({ type: "setToolMode", mode: "avatar" })}
        >
          Avatar
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-16 text-xs text-foreground/60">Motion</div>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={motionId}
            onChange={(e) => {
              const next = e.target.value;
              setMotionId(next);
              const entry = motions.find((m) => m.id === next);
              if (entry) setLoop(entry.loop ?? true);
            }}
          >
            {motions.map((motion) => (
              <option key={motion.id} value={motion.id}>
                {motion.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-xs text-foreground/70">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />
          Loop
        </label>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={playDisabled}
            onClick={() => sendCommand({ type: "playMotion", motionId, loop })}
          >
            Play
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => sendCommand({ type: "stopMotion" })}
          >
            Stop
          </Button>
          <div
            className={cn(
              "ml-auto text-xs",
              snapshot ? "text-foreground/60" : "text-foreground/40"
            )}
          >
            {snapshot ? "synced" : "waiting avatar…"}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-16 text-xs text-foreground/60">Emotion</div>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={currentEmotion}
            onChange={(e) =>
              sendCommand({
                type: "setEmotion",
                emotion: e.target.value as EmotionId,
                intensity: currentIntensity,
              })
            }
          >
            {emotionOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-16 text-xs text-foreground/60">Intensity</div>
          <input
            className="w-full"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={currentIntensity}
            onChange={(e) =>
              sendCommand({
                type: "setEmotion",
                emotion: currentEmotion,
                intensity: Number(e.target.value),
              })
            }
          />
          <div className="w-10 text-right font-mono text-xs text-foreground/70">
            {currentIntensity.toFixed(2)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => sendCommand({ type: "resetEmotion" })}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

