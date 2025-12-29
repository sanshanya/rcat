import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";

import { Eye, EyeOff, Pencil, Plus, XIcon } from "lucide-react";

import { Capsule } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiConfig, AiModel, AiProvider } from "@/types";
import { cn } from "@/lib/utils";
import { setAiProfile, setAiProvider, testAiProfile } from "@/services";

export type SettingsViewProps = {
  capsuleProps: ComponentProps<typeof Capsule>;
  aiConfig: AiConfig | null;
  onRefreshAiConfig: () => Promise<AiConfig | null>;
  onClose: () => void;
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  compatible: "OpenAI-compatible",
};

type ModelEditorDraft = {
  originalId: string | null;
  id: string;
  maxContext: string;
  maxOutput: string;
  supportsVision: boolean;
  supportsThink: boolean;
  special: string;
};

export function SettingsView({
  capsuleProps,
  aiConfig,
  onRefreshAiConfig,
  onClose,
}: SettingsViewProps) {
  const initialProvider: AiProvider = useMemo(() => {
    return aiConfig?.provider ?? "deepseek";
  }, [aiConfig?.provider]);

  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [providerSaving, setProviderSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelEditor, setModelEditor] = useState<ModelEditorDraft | null>(null);
  const [modelEditorError, setModelEditorError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    setBaseUrl(aiConfig?.baseUrl ?? "");
    const nextModels = aiConfig?.models ?? [];
    setModels(nextModels);
    setModel(aiConfig?.model ?? nextModels[0]?.id ?? "");
    setApiKey(aiConfig?.apiKey ?? "");
  }, [
    aiConfig?.apiKey,
    aiConfig?.baseUrl,
    aiConfig?.model,
    aiConfig?.models,
    aiConfig?.provider,
  ]);

  const handleProviderChange = useCallback(
    (next: string) => {
      const nextProvider = next as AiProvider;
      setProvider(nextProvider);
      setProviderSaving(true);
      setError(null);
      setSuccess(null);

      void setAiProvider(nextProvider)
        .then(() => onRefreshAiConfig())
        .catch((err) => {
          setError(String(err));
          void onRefreshAiConfig();
        })
        .finally(() => setProviderSaving(false));
    },
    [onRefreshAiConfig]
  );

  const busy = providerSaving || testing;

  const normalizedModels = useMemo(() => {
    const out: AiModel[] = [];
    const seen = new Set<string>();

    for (const m of models) {
      const id = (m.id ?? "").trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        maxContext: m.maxContext ?? null,
        maxOutput: m.maxOutput ?? null,
        supportsVision: Boolean(m.supportsVision),
        supportsThink: Boolean(m.supportsThink),
        special: (m.special ?? "").trim() || null,
      });
    }

    const selected = model.trim();
    if (selected && !seen.has(selected)) {
      out.unshift({
        id: selected,
        maxContext: null,
        maxOutput: null,
        supportsVision: false,
        supportsThink: false,
        special: null,
      });
    }

    return out;
  }, [model, models]);

  const openAddModel = useCallback(() => {
    setModelEditorError(null);
    setModelEditor({
      originalId: null,
      id: "",
      maxContext: "",
      maxOutput: "",
      supportsVision: false,
      supportsThink: false,
      special: "",
    });
  }, []);

  const openEditModel = useCallback((m: AiModel) => {
    setModelEditorError(null);
    setModelEditor({
      originalId: m.id,
      id: m.id,
      maxContext: m.maxContext ? String(m.maxContext) : "",
      maxOutput: m.maxOutput ? String(m.maxOutput) : "",
      supportsVision: Boolean(m.supportsVision),
      supportsThink: Boolean(m.supportsThink),
      special: m.special ?? "",
    });
  }, []);

  const closeModelEditor = useCallback(() => {
    setModelEditor(null);
    setModelEditorError(null);
  }, []);

  const handleSaveModelDraft = useCallback(() => {
    if (!modelEditor) return;

    const nextId = modelEditor.id.trim();
    if (!nextId) {
      setModelEditorError("Model ID 不能为空");
      return;
    }

    const parsePositiveIntOrNull = (raw: string, label: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return { value: null as number | null, error: null as string | null };
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return { value: null as number | null, error: `${label} 需要为正整数` };
      }
      return { value: n, error: null as string | null };
    };

    const maxContextParsed = parsePositiveIntOrNull(modelEditor.maxContext, "最大上下文");
    if (maxContextParsed.error) {
      setModelEditorError(maxContextParsed.error);
      return;
    }

    const maxOutputParsed = parsePositiveIntOrNull(modelEditor.maxOutput, "最大输出");
    if (maxOutputParsed.error) {
      setModelEditorError(maxOutputParsed.error);
      return;
    }

    const special = modelEditor.special.trim() || null;
    const originalId = modelEditor.originalId?.trim() ?? null;

    const hasDuplicate = normalizedModels.some((m) => {
      if (originalId && m.id === originalId) return false;
      return m.id === nextId;
    });
    if (hasDuplicate) {
      setModelEditorError("该 Model ID 已存在");
      return;
    }

    const spec: AiModel = {
      id: nextId,
      maxContext: maxContextParsed.value,
      maxOutput: maxOutputParsed.value,
      supportsVision: modelEditor.supportsVision,
      supportsThink: modelEditor.supportsThink,
      special,
    };

    setModels((prev) => {
      const next: AiModel[] = [];
      let replaced = false;

      for (const item of prev) {
        const itemId = (item.id ?? "").trim();
        if (originalId && itemId === originalId) {
          next.push(spec);
          replaced = true;
        } else {
          next.push(item);
        }
      }

      if (!replaced) {
        next.push(spec);
      }

      return next;
    });

    setModel((current) => {
      if (!current.trim()) return nextId;
      if (originalId && current.trim() === originalId) return nextId;
      return current;
    });

    closeModelEditor();
  }, [closeModelEditor, modelEditor, normalizedModels]);

  const handleRemoveModel = useCallback(
    (targetId: string) => {
      const target = targetId.trim();
      if (!target) return;

      const remaining = normalizedModels.filter((m) => m.id !== target);
      if (remaining.length === 0) return;

      setModels((prev) => prev.filter((m) => (m.id ?? "").trim() !== target));
      setModel((current) => {
        if (current.trim() !== target) return current;
        return remaining[0]?.id ?? "";
      });
    },
    [normalizedModels]
  );

  const handleTestAndSave = useCallback(() => {
    setTesting(true);
    setError(null);
    setSuccess(null);

    void testAiProfile({ provider, baseUrl, model, apiKey })
      .then(() =>
        setAiProfile({
          provider,
          baseUrl,
          model,
          apiKey,
          models: normalizedModels,
        })
      )
      .then(() => onRefreshAiConfig())
      .then(() => setSuccess("测试成功，已保存"))
      .catch((err) => {
        setError(String(err));
        void onRefreshAiConfig();
      })
      .finally(() => setTesting(false));
  }, [apiKey, baseUrl, model, normalizedModels, onRefreshAiConfig, provider]);

  const handleSave = useCallback(() => {
    setTesting(true);
    setError(null);
    setSuccess(null);

    void setAiProfile({
      provider,
      baseUrl,
      model,
      apiKey,
      models: normalizedModels,
    })
      .then(() => onRefreshAiConfig())
      .then(() => setSuccess("已保存"))
      .catch((err) => {
        setError(String(err));
        void onRefreshAiConfig();
      })
      .finally(() => setTesting(false));
  }, [apiKey, baseUrl, model, normalizedModels, onRefreshAiConfig, provider]);

  return (
    <>
      <Capsule {...capsuleProps} />

      <div className="flex min-h-0 w-full flex-1 flex-col rounded-2xl border border-border/50 bg-muted/60 p-3 shadow-md">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">设置</div>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            )}
            onClick={onClose}
            title="关闭"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 text-sm text-muted-foreground">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-foreground/80">AI</div>
            <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs">
                  <span className="opacity-70">Provider</span>
                </div>
                <Select
                  value={provider}
                  onValueChange={handleProviderChange}
                  disabled={busy}
                >
                  <SelectTrigger className="h-7 px-2 py-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepseek">{PROVIDER_LABELS.deepseek}</SelectItem>
                    <SelectItem value="openai">{PROVIDER_LABELS.openai}</SelectItem>
                    <SelectItem value="compatible">{PROVIDER_LABELS.compatible}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <div className="grid gap-1">
                  <div className="text-xs opacity-70">Base URL</div>
                  <input
                    className={cn(
                      "h-7 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                      "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    )}
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={busy}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                <div className="grid gap-1">
                  <div className="text-xs opacity-70">Models</div>
                  <div className="flex flex-wrap gap-1">
                    {normalizedModels.map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/30 px-1 py-1",
                          m.id === model && "border-primary/60 bg-primary/10"
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "max-w-[210px] truncate px-1 text-xs text-foreground/90",
                            m.id !== model && "opacity-80 hover:opacity-100"
                          )}
                          onClick={() => setModel(m.id)}
                          disabled={busy}
                          title={m.id}
                        >
                          {m.id}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6"
                          onClick={() => openEditModel(m)}
                          disabled={busy}
                          title="编辑"
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-6 w-6"
                          onClick={() => handleRemoveModel(m.id)}
                          disabled={busy || normalizedModels.length <= 1}
                          title="删除"
                        >
                          <XIcon className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={openAddModel}
                    disabled={busy}
                  >
                    <Plus className="size-4" />
                    添加模型
                  </Button>
                </div>

                <div className="grid gap-1">
                  <div className="text-xs opacity-70">API Key</div>
                  <div className="flex items-center gap-1">
                    <input
                      className={cn(
                        "h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                        "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      )}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      disabled={busy}
                      type={showApiKey ? "text" : "password"}
                      placeholder="请输入 API Key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowApiKey((v) => !v)}
                      disabled={busy}
                      title={showApiKey ? "隐藏" : "显示"}
                    >
                      {showApiKey ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </div>

                {error ? <div className="text-xs text-red-200/90">{error}</div> : null}
                {success ? (
                  <div className="text-xs text-emerald-200/90">{success}</div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleSave}
                    disabled={busy}
                  >
                    保存
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleTestAndSave}
                    disabled={
                      busy ||
                      !baseUrl.trim() ||
                      !model.trim() ||
                      !apiKey.trim() ||
                      normalizedModels.length === 0
                    }
                  >
                    测试
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {modelEditor ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={closeModelEditor}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border/50 bg-background/90 p-3 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">
                {modelEditor.originalId ? "编辑模型" : "添加模型"}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={closeModelEditor}
                title="关闭"
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <div className="grid gap-1">
                <div className="text-xs opacity-70">Model ID</div>
                <input
                  className={cn(
                    "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                    "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  )}
                  value={modelEditor.id}
                  onChange={(e) =>
                    setModelEditor((prev) =>
                      prev ? { ...prev, id: e.target.value } : prev
                    )
                  }
                  placeholder="例如 deepseek-chat"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <div className="text-xs opacity-70">最大上下文</div>
                  <input
                    className={cn(
                      "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                      "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    )}
                    value={modelEditor.maxContext}
                    onChange={(e) =>
                      setModelEditor((prev) =>
                        prev ? { ...prev, maxContext: e.target.value } : prev
                      )
                    }
                    placeholder="可选"
                    inputMode="numeric"
                  />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs opacity-70">最大输出</div>
                  <input
                    className={cn(
                      "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                      "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    )}
                    value={modelEditor.maxOutput}
                    onChange={(e) =>
                      setModelEditor((prev) =>
                        prev ? { ...prev, maxOutput: e.target.value } : prev
                      )
                    }
                    placeholder="可选"
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-foreground/80">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={modelEditor.supportsVision}
                    onChange={(e) =>
                      setModelEditor((prev) =>
                        prev ? { ...prev, supportsVision: e.target.checked } : prev
                      )
                    }
                  />
                  支持 Vision
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground/80">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={modelEditor.supportsThink}
                    onChange={(e) =>
                      setModelEditor((prev) =>
                        prev ? { ...prev, supportsThink: e.target.checked } : prev
                      )
                    }
                  />
                  支持 Think
                </label>
              </div>

              <div className="grid gap-1">
                <div className="text-xs opacity-70">Special（可选）</div>
                <input
                  className={cn(
                    "h-8 w-full rounded-md border border-border/50 bg-background/40 px-2 text-xs text-foreground",
                    "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  )}
                  value={modelEditor.special}
                  onChange={(e) =>
                    setModelEditor((prev) =>
                      prev ? { ...prev, special: e.target.value } : prev
                    )
                  }
                  placeholder="例如: special"
                />
              </div>

              {modelEditorError ? (
                <div className="text-xs text-red-200/90">{modelEditorError}</div>
              ) : null}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" size="sm" variant="secondary" onClick={closeModelEditor}>
                  取消
                </Button>
                <Button type="button" size="sm" onClick={handleSaveModelDraft}>
                  确认
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default SettingsView;
