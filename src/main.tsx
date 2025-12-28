import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { reportError } from "./utils";

if (import.meta.env.DEV) {
  void import("./dev/visionTest")
    .then(({ installVisionTest }) => installVisionTest())
    .catch((err) => reportError(err, "dev/visionTest", { devOnly: true }));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
