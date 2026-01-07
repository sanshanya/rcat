**发现项**

**中优先级：**
`useVrmRenderer.ts`（第 71 行）仍缺少对 `webglcontextlost` / `webglcontextrestored` 事件的处理，因此在长时间运行的会话中，渲染循环可能冻结且无法恢复。

**低优先级：**
`useVrmBehavior.ts`（第 146 行）调用了 `expressionManager.update()`，而 `useVrmRenderer.ts`（第 147 行）已调用 `currentVrm.update(delta)`（该函数会更新表情）。这是冗余的，且可能因 three-vrm 内部机制导致权重被重复应用。

`VrmDebugPanel.tsx`（第 37 行）仅在管理器变更时读取表情值；如果唇形同步/自动行为更新了表情值，滑块将不会反映这些变化，可能在调试时产生误导。

**问题**

1. 您希望现在处理 WebGL 上下文丢失事件，还是将其推迟到 SkinManager 里程碑阶段？
2. 调试滑块应是 **权威性的** （覆盖自动表情），还是仅用于 **反映当前表情值** ？
