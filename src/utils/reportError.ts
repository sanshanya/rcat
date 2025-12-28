type ReportErrorOptions = {
  /**
   * When provided, the same key is only reported once per session.
   */
  onceKey?: string;
  /**
   * Only log in dev builds.
   */
  devOnly?: boolean;
  /**
   * `console` level to use.
   */
  level?: "error" | "warn";
};

const reportedOnce = new Set<string>();

const isDevBuild = (): boolean => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
};

export function reportError(
  error: unknown,
  context?: string,
  options: ReportErrorOptions = {}
): void {
  const key = options.onceKey?.trim();
  if (key) {
    if (reportedOnce.has(key)) return;
    reportedOnce.add(key);
  }

  if (options.devOnly && !isDevBuild()) return;

  const prefix = context ? `[${context}]` : "";
  const payload = prefix ? [prefix, error] : [error];

  if (options.level === "warn") {
    console.warn(...payload);
    return;
  }
  console.error(...payload);
}

export const reportPromiseError =
  (context: string, options: Omit<ReportErrorOptions, "level"> = {}) =>
  (error: unknown) =>
    reportError(error, context, options);

