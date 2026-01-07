import { useEffect, useMemo, useState } from "react";

import type { VRMExpressionManager } from "@pixiv/three-vrm";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { useVrmState } from "@/components/vrm/vrmStore";
import { cn } from "@/lib/utils";

type DebugExpressionName = "aa" | "happy";

type SliderConfig = {
  id: DebugExpressionName;
  label: string;
};

const SLIDERS: SliderConfig[] = [
  { id: "aa", label: "AA" },
  { id: "happy", label: "Happy" },
];

const EMPTY_VALUES: Record<DebugExpressionName, number> = {
  aa: 0,
  happy: 0,
};

export type VrmDebugPanelProps = {
  inline?: boolean;
  className?: string;
};

export default function VrmDebugPanel({ inline = false, className }: VrmDebugPanelProps) {
  const { vrm } = useVrmState();
  const manager = (vrm?.expressionManager ?? null) as VRMExpressionManager | null;
  const driver = useMemo(() => createExpressionDriver(manager), [manager]);
  const [values, setValues] = useState<Record<DebugExpressionName, number>>(EMPTY_VALUES);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!manager) {
      setValues(EMPTY_VALUES);
      return;
    }

    setValues({
      aa: driver.getValue("aa"),
      happy: driver.getValue("happy"),
    });
  }, [driver, manager]);

  useEffect(() => {
    if (!manager) return;
    (Object.keys(values) as DebugExpressionName[]).forEach((key) => {
      driver.setValue(key, values[key]);
    });
  }, [driver, manager, values]);

  const containerClass = inline
    ? "w-full rounded-xl border border-border/60 bg-background/60 p-2 shadow-sm"
    : "absolute right-3 top-3 z-20 w-56 rounded-xl border border-border/60 bg-background/80 p-3 shadow-lg backdrop-blur";

  return (
    <div className={cn(containerClass, className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground/80">VRM Debug</div>
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {collapsed ? null : (
        <div className="mt-2 space-y-2">
          {manager ? null : (
            <div className="rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              没有检测到 VRM 表情通道
            </div>
          )}
          {SLIDERS.map((slider) => {
            const disabled = !driver.supports(slider.id);
            return (
              <label key={slider.id} className="grid gap-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-foreground/80">{slider.label}</span>
                  <span className="text-muted-foreground">
                    {values[slider.id].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={values[slider.id]}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setValues((prev) => ({ ...prev, [slider.id]: next }));
                  }}
                  className={cn(
                    "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70",
                    "accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
