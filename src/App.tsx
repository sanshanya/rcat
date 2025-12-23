import { useState, useEffect } from "react";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
// ✅ 1. 引入常量
import { EVT_CLICK_THROUGH_STATE } from "./constants";

const appWindow = getCurrentWindow();

function App() {
  const [isClickThrough, setIsClickThrough] = useState(false);

  useEffect(() => {
    // ✅ 2. 使用常量
    // 鼠标放上去，IDE 会提示你这个常量的具体值，非常有安全感
    const unlistenPromise = listen<boolean>(EVT_CLICK_THROUGH_STATE, (event) => {
      setIsClickThrough(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    if ("button" in e && e.button !== 0) return;
    if (isClickThrough) return;

    e.preventDefault();
    e.stopPropagation();
    void appWindow.startDragging();
  };

  return (
    <div className={`container ${isClickThrough ? "click-through-mode" : ""}`}>
      <div className="drag-handle" onPointerDown={startDrag}>
        <div className="handle-bar"></div>
      </div>
      <div className="capsule">
        Rust Capsule
      </div>
    </div>
  );
}

export default App;