# P0: VRM Avatar MVP Implementation Plan

**Goal**: VRM 皮肤下以角色为核心交互对象：角色窗口常驻桌面（透明/置顶/不可穿透且尽量贴合），左键拖动移动，左键按住滚轮缩放（窗口大小同步），右键呼出聊天面板并可自动隐藏。

---

## Architecture Decisions

| Concern | Decision |
|---------|----------|
| Hook isolation | `AvatarApp` (main) vs `ContextPanelApp` (context) — each only subscribes to needed events |
| Hotkeys | P0 不做任何快捷键（鼠标交互为主） |
| Avatar interaction | 角色窗口始终不可穿透（不做点击穿透/输入门控） |
| Avatar sizing | VRM 模式下主窗口按“角色窗口”使用：支持滚轮缩放并持久化 VRM 尺寸 |
| Anchor calculation | Rust-side using `outer_position`/`outer_size` + monitor work area |
| ContextPanel lifecycle | `hide()`/`show()` (not close/recreate); Rust `Focused(false)` triggers close if not pinned |
| VrmDebugPanel | Conditional render in `VrmStage`; migrated to ContextPanel in P1 |

---

## Proposed Changes

### 1. WindowManager State Machine
#### [NEW] [window_manager.rs](file:///f:/github/rcat/src-tauri/src/services/window_manager.rs)
```rust
pub struct WindowManagerState {
    skin: Skin,                    // Vrm | Classic
    context_panel: PanelState,     // Closed | Open | Pinned
}
```
- **Commands**: `open_context_panel`, `hide_context_panel`, `scale_avatar_window`.
- **Avatar window rules (VRM)**:
  - 强制 `set_ignore_cursor_events(false)`（不可穿透）
  - `set_decorations(false)` + `set_resizable(false)`（角色窗口语义）
  - 尺寸：从 `window_state.json` 恢复 VRM 尺寸；无记录则使用默认值（例如 `420x720`）
  - 缩放：前端在“左键按住 + 滚轮”时调用 `scale_avatar_window(factor)`；后端按 bottom-center 锚点缩放并 clamp 到 work area
- **Persistence**: VRM 的窗口尺寸单独持久化（不能写入 classic 的 input/result 逻辑尺寸）
- **Anchor calculation**: Use `main.outer_position()` + `main.outer_size()` + `monitor.work_area()`.
- **Context lifecycle**: On `Focused(false)` for context window → if not pinned, call `hide()`.

---

### 2. Frontend Entry Point
#### [MODIFY] [main.tsx](file:///f:/github/rcat/src/main.tsx)
```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";

const label = getCurrentWindow().label; // sync, not await
if (label === "context") {
  ReactDOM.createRoot(...).render(<ContextPanelApp />);
} else {
  // Main window keeps classic + vrm switch (skin decides which surface to mount).
  ReactDOM.createRoot(...).render(<App />);
}
```

#### [NEW] [AvatarApp.tsx](file:///f:/github/rcat/src/AvatarApp.tsx)
- VRM skin only：Renders `VrmStage` only (no chat hooks).
- Handles `onContextMenu` → `invoke('open_context_panel')`.
- Handles `startDragging()` (左键拖动移动窗口)。
- Handles `onWheel` (左键按住 + 滚轮缩放窗口) → `invoke('scale_avatar_window')`.

#### [NEW] [ContextPanelApp.tsx](file:///f:/github/rcat/src/ContextPanelApp.tsx)
- Renders `ChatPanel` (P0) | `DebugPanel` (P1) tabs.
- Subscribes to: `EVT_CHAT_STREAM`, `EVT_CHAT_DONE`, conversation events.
- On mount: focus input.
- Close by button or click-outside (panel blur → backend auto-hide).

---

### 3. VrmDebugPanel Migration
#### [MODIFY] [VrmStage.tsx](file:///f:/github/rcat/src/components/vrm/VrmStage.tsx)
```diff
-<VrmDebugPanel className="pointer-events-auto" />
+{showDebugOverlay && <VrmDebugPanel className="pointer-events-auto" />}
```
- `showDebugOverlay` prop defaults to `false` in VRM skin mode.
- Full debug moves to ContextPanel in P1.

---

### 4. Tauri Window Config
#### (Preferred) Lazy create `context` window in Rust
- 由 `open_context_panel` 在首次右键时创建 `label=context`，避免 classic 模式提前加载 ContextPanel 导致重复 hooks。
- 如果后续确实要在 `tauri.conf.json` 静态声明窗口，也要保证 ContextPanel 在隐藏/非 VRM 时不启动聊天逻辑。

---

## Verification Plan

| Step | Action | Expected |
|------|--------|----------|
| 1 | Launch, skin=classic | Mini/Input/Result works unchanged |
| 2 | Switch to skin=vrm | Only character visible, transparent BG, no debug panel |
| 3 | 左键拖动角色 | 角色窗口跟随移动，ContextPanel（若打开）跟随并必要时翻转 |
| 4 | 左键按住 + 滚轮 | 角色窗口缩放（保持贴合与 clamp），VRM 尺寸被持久化 |
| 5 | 右键角色 | ContextPanel 在角色附近出现且输入框聚焦 |
| 6 | 发送消息 | 流式输出只在 ContextPanel 中渲染 |
| 7 | 点击桌面其它区域 | ContextPanel 自动隐藏（未 pin 时） |
