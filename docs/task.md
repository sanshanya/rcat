# VRM V1 改造任务清单

> 基于 [implementation_plan.md](../implementation_plan.md)，Windows-only Demo

---

## v0.1 — 最小可跑通

### 后端：窗口与 Subclass

- [X] 新建 `src-tauri/src/windows/` 模块结构
  - [X] `mod.rs` 导出
  - [X] `avatar_window.rs`：HWND 获取 + `SetWindowSubclass`
  - [X] `panel_window.rs`：胶囊创建/定位
  - [X] `hittest_mask.rs`：`MaskSnapshot` + `ArcSwap`
- [X] Windows 依赖对齐：`windows` crate = `0.61.3`（与 `tauri-runtime` 一致）+ 启用 `Win32_UI_Shell` / `Win32_UI_Input_KeyboardAndMouse` + `windows-future(std)`（允许 WinRT `.await`）
- [X] Tauri Capabilities：`src-tauri/capabilities/default.json` 覆盖 `avatar`（允许事件 listen/emit 等）
- [X] cursor gate 命中/穿透（`set_ignore_cursor_events`）
  - [X] 两级判定：粗 rect → 细 bitset
  - [X] 缺数据时保持 click-through（`ignore_cursor_events=true`）
  - [X] 坐标映射：`ScreenToClient` → clientRect → mask
- [X] `WM_MOUSEACTIVATE` 返回 `MA_NOACTIVATE`（P0：不抢焦点）
- [X] 窗口销毁时 `RemoveWindowSubclass`
- [X] 兜底入口：托盘菜单"打开胶囊"（不做任何快捷键）

### 后端：Tauri Commands

- [X] `avatar_update_hittest_mask`
  - [X] 参数：`seq, maskW, maskH, rect, bitsetBase64, viewportW, viewportH`
  - [X] 只保留最新 seq，丢弃过期
  - [X] sanity check：viewport 与 clientRect 差异告警
- [X] `open_capsule`
  - [X] 参数：`tab, anchorX, anchorY`
  - [X] 创建/显示 `ContextPanelWindow`
  - [X] 多显示器定位 + 边界 clamp
  - [X] emit `capsule-opened` 到 Panel

### 前端：AvatarWindow

- [X] 路由分发：根据窗口 label 渲染 `AvatarRoot` 或 `PanelRoot`
- [X] `MaskGenerator.ts`
  - [X] `scene.overrideMaterial` 渲染到小 RT
  - [X] `readPixels` → 二值化（alpha >= 32）
  - [X] 可选：膨胀 1–3px
  - [X] bitset 打包（y 翻转）→ base64
- [X] `useHitTestMask.ts`
  - [X] 兜底 10Hz 定时更新
  - [X] `invoke("avatar_update_hittest_mask", ...)`
  - [X] `visibilitychange` 监听：不可见时暂停
- [X] 右键交互
  - [X] `contextmenu` / `pointerdown(button=2)` 捕获
  - [X] `preventDefault()` + `invoke("open_capsule", ...)`

### 前端：ContextPanelWindow

- [X] `PanelRoot.tsx` 复用现有 Chat UI
- [X] 监听 `capsule-opened` 切换 tab（v0.1 先维护 activeTab 状态，v0.3 完整 Tabs UI）

### DoD v0.1

- [X] 点模型像素 → 事件到达 Three.js
- [X] 点透明区域 → 透传到底层窗口
- [X] 右键模型 → 稳定唤出胶囊
- [X] 胶囊可正常输入/交互
- [X] AvatarWindow 点击不抢焦点
- [X] mask 未就绪时仍有入口可用（托盘菜单“打开胶囊”）

---

## v0.2 — 交互更像桌宠

### 拖拽移动角色

- [X] 方案选择（二选一）
  - [X] Tool=Pet：左键拖拽 → 移动窗口（角色一起走）
  - [X] Tool=Model：左键拖拽 → 仅移动模型（窗口不动）
  - [ ] Win32 `HTCAPTION`（已弃用，不走该方案）

### 动态 Mask 刷新

- [X] 检测条件
  - [X] motion active（跳舞/动作）
  - [X] pointer down（用户交互）
  - [X] 相机变化（Orbit/fit）
  - [X] 窗口 resize
- [X] 条件触发时提升到 30Hz

### Debug Overlay

- [X] 显示当前 bounding rect
- [X] 显示 mask 命中点
- [X] 显示刷新频率 / last update time

### DoD v0.2

- [X] 可拖拽移动角色位置
- [X] 跳舞时命中区域同步更新无明显延迟
- [X] Debug overlay 可用于问题定位

---

## v0.3 — VRM/Debug 面板搬进胶囊

### Panel 拆分

- [X] Chat Tab（已有）
- [X] VRM Tab
  - [X] 动作列表/播放
  - [X] 表情控制（v0.3 先做 Emotion + intensity；精细 expression bindings 后续补）
  - [X] 工具模式切换
- [X] Debug Tab
  - [X] FPS 模式切换
  - [X] mouse tracking 参数（v0.3 先做 enabled 开关；细参后续补）
  - [X] HUD layout 开关（locked/editing）

### 命令总线

- [X] Panel → Rust → Avatar 事件路径
  - [X] `invoke("vrm_command", payload)`
  - [X] Rust 转发 `avatarWindow.emit("vrm-command", payload)`
  - [X] Avatar 监听并应用
- [X] 持久化配置走 `services::config`（Rust 单一真源）
- [X] 运行时命令走事件总线

### 状态同步（P1）

- [X] Panel 打开时拉取 Avatar 状态快照
  - [X] Rust emit `vrm-state-request`
  - [X] Avatar invoke `vrm_state_snapshot`
  - [X] Rust 转发给 Panel
- [X] Panel 操作后自动刷新状态快照（Avatar 侧在处理 command 后 push snapshot，并做节流）

### DoD v0.3

- [X] VRM/Debug 面板完整可用于胶囊
- [X] Panel 操作能正确控制 Avatar 行为
- [X] Panel 打开时显示正确的当前状态

---

## P1 增强项（可穿插进行）

### 异步 Readback

- [X] 实现 WebGL2 PBO + fence 的异步 readback（默认开启；可在 DebugTab 关闭；不支持时自动回退 sync）
- [ ] 评估 OffscreenCanvas + Worker（见 `docs/P1_OffscreenCanvas_Worker.md`）
- [X] WebGL2 路径替换同步 `readPixels`（fallback 保留用于不支持/异常）

### 边缘稳定性

- [X] alpha 阈值可调（Panel/Debug Tab；默认 32）
- [X] rect 时间滤波（指数平滑；expand fast / shrink slow）
- [X] 膨胀参数可调（Panel/Debug Tab；默认 1）

### 动作/观感（桌宠）

- [X] Root motion 收敛为 in-place（避免动作自带位移把模型带离窗口）
- [X] FBX 脚底稳定：轻量 foot-plant IK（VMD 轨已自带 IK target）

### 多显示器 / 高 DPI

- [X] `MonitorFromPoint` 正确选择显示器
- [X] 胶囊贴边翻转逻辑
- [X] Avatar 右键召唤用 Win32 `GetCursorPos` 取 anchor（避免 WebView2/DPI 坐标差异）
- [X] 统计并可视化 viewport/client mismatch（用于高 DPI 排查）
- [X] overlay 显示 dpr/client/viewport（便于验证 150%/200%）
- [ ] 高 DPI（150%/200%）验证

---

## 测试矩阵

> 建议开启 Debug overlay（红框 + 小红点）并在 Panel/Debug Tab 中可视化调参（alphaThreshold/dilation/maxEdge/rectSmooth），再逐项打勾。

| 场景                    | 状态 |
| ----------------------- | ---- |
| 模型静止 - 点击命中     | [ ]  |
| 模型静止 - 透明区域透传 | [ ]  |
| 模型跳舞 - 命中跟随     | [ ]  |
| 窗口 resize             | [ ]  |
| 高 DPI 150%             | [ ]  |
| 高 DPI 200%             | [ ]  |
| 多显示器 - 不同 DPI     | [ ]  |
| 刚启动 - mask 未就绪    | [ ]  |
| 快速连续点击            | [ ]  |

---

## VRM V2（Roadmap）

见 `docs/VRM_V2.md`。
