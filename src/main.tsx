import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import ErrorBoundary from "./components/ErrorBoundary";
import { reportError } from "./utils";
import WindowRouter from "./windows/WindowRouter";

if (import.meta.env.DEV) {
  void import("./dev/visionTest")
    .then(({ installVisionTest }) => installVisionTest())
    .catch((err) => reportError(err, "dev/visionTest", { devOnly: true }));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WindowRouter />
    </ErrorBoundary>
  </React.StrictMode>,
);
