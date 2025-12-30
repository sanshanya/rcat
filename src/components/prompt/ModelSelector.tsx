import type { ModelOption } from "@/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ModelSelectorProps = {
  model: string;
  modelOptions: ModelOption[];
  disabled?: boolean;
  onModelChange: (model: string) => void;
};

export function ModelSelector({
  model,
  modelOptions,
  disabled = false,
  onModelChange,
}: ModelSelectorProps) {
  return (
    <Select
      value={model}
      onValueChange={onModelChange}
      disabled={disabled || modelOptions.length === 0}
    >
      <SelectTrigger
        className="min-w-[100px] shrink"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent side="bottom" align="end" sideOffset={4}>
        {modelOptions.map((m) => (
          <SelectItem key={m.id} value={m.id} title={m.name}>
            {m.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
