import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/index.css";
import App from "./App";
import ContextPanelApp from "./ContextPanelApp";
import ErrorBoundary from "./components/ErrorBoundary";
import { isTauriContext, reportError } from "./utils";

if (import.meta.env.DEV) {
  void import("./dev/visionTest")
    .then(({ installVisionTest }) => installVisionTest())
    .catch((err) => reportError(err, "dev/visionTest", { devOnly: true }));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {(() => {
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.get("window") === "context") {
            return <ContextPanelApp />;
          }
        } catch {
          // Ignore URL parsing failures.
        }

        if (!isTauriContext()) return <App />;
        try {
          const label = getCurrentWindow().label;
          return label === "context" ? <ContextPanelApp /> : <App />;
        } catch {
          return <App />;
        }
      })()}
    </ErrorBoundary>
  </React.StrictMode>,
);
