import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  analyzeScreenVlm,
  captureScreenText,
  captureSmart,
  getSmartWindow,
  listCapturableWindows,
} from "@/services";
import { isTauriContext } from "@/utils";

type VisionTestApi = {
  captureScreenText: typeof captureScreenText;
  analyzeScreenVlm: typeof analyzeScreenVlm;
  listCapturableWindows: typeof listCapturableWindows;
  captureSmart: typeof captureSmart;
  getSmartWindow: typeof getSmartWindow;
  testOCR: () => Promise<unknown>;
  testSmart: () => Promise<unknown>;
  testVLM: (prompt?: string) => Promise<unknown>;
  listWindows: () => Promise<unknown>;
  smartWindow: () => Promise<unknown>;
  testToolChat: (prompt?: string) => Promise<void>;
};

declare global {
  interface Window {
    visionTest?: VisionTestApi;
  }
}

export function installVisionTest(): void {
  if (typeof window === "undefined") return;
  if (!isTauriContext()) return;

  window.visionTest = {
    captureScreenText,
    analyzeScreenVlm,
    listCapturableWindows,
    captureSmart,
    getSmartWindow,

    async testOCR() {
      console.log("🔍 开始 OCR 测试...");
      const result = await captureScreenText();
      console.log("✅ OCR 结果:", result);
      return result;
    },

    async testSmart() {
      console.log("🧠 开始智能捕获...");
      const result = await captureSmart();
      console.log("✅ 智能捕获结果:", result);
      return result;
    },

    async testVLM(prompt = "描述这个屏幕上的内容") {
      console.log("🤖 开始 VLM 分析...");
      const result = await analyzeScreenVlm(prompt);
      console.log("✅ VLM 结果:", result);
      return result;
    },

    async listWindows() {
      const windows = await listCapturableWindows();
      console.log("📋 可用窗口 (按Z序):", windows);
      return windows;
    },

    async smartWindow() {
      const win = await getSmartWindow();
      console.log("🎯 智能选中窗口:", win);
      return win;
    },

    async testToolChat(prompt = "请告诉我用户当前正在使用哪些应用程序") {
      console.log("🛠️ 开始工具调用测试...");
      const requestId = `test_${Date.now()}`;

      const unlisten = await listen<{
        delta: string;
        kind: string;
        done: boolean;
      }>("chat-stream", (event) => {
        const { delta, kind, done } = event.payload;
        if (done) {
          console.log("✅ 完成");
          return;
        }
        if (kind === "reasoning") {
          console.log("🔧", delta);
        } else {
          console.log("💬", delta);
        }
      });

      try {
        await invoke("chat_stream_with_tools", {
          requestId,
          messages: [{ role: "user", content: prompt }],
          model: null,
          requestOptions: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 10_000));
      } finally {
        unlisten();
      }
    },
  };

  console.log('💡 测试: visionTest.testToolChat("帮我看看QQ消息")');
}

