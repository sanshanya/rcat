import React from "react";

import { reportError } from "@/utils";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError({ error, info }, "ErrorBoundary");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const details =
      (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
        ? error.stack || error.message
        : error.message;

    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent p-3 text-foreground">
        <div className="w-full max-w-sm rounded-xl border border-border/50 bg-background/90 p-4 shadow-lg">
          <div className="text-sm font-semibold">UI crashed</div>
          <div className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {details}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/70"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

