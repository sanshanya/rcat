# VRM V1 改造任务清单

> 基于 [implementation_plan.md](file:///e:/rcat/docs/vrm_v1_implementation_plan.md)，Windows-only Demo

---

## v0.1 — 最小可跑通

### 后端：窗口与 Subclass

- [x] 新建 `src-tauri/src/windows/` 模块结构
  - [x] `mod.rs` 导出
  - [x] `avatar_window.rs`：HWND 获取 + `SetWindowSubclass`
  - [x] `panel_window.rs`：胶囊创建/定位
  - [x] `hittest_mask.rs`：`MaskSnapshot` + `ArcSwap`
- [x] Windows 依赖对齐：`windows` crate = `0.61.3`（与 `tauri-runtime` 一致）+ 启用 `Win32_UI_Shell` / `Win32_UI_Input_KeyboardAndMouse` + `windows-future(std)`（允许 WinRT `.await`）
- [x] Tauri Capabilities：`src-tauri/capabilities/default.json` 覆盖 `avatar`（允许事件 listen/emit 等）
- [x] `WM_NCHITTEST` 处理
  - [x] 两级判定：粗 rect → 细 bitset
  - [x] 缺数据时返回 `HTTRANSPARENT`
  - [x] 坐标映射：`ScreenToClient` → viewport → mask
- [x] `WM_MOUSEACTIVATE` 返回 `MA_NOACTIVATE`（P0：不抢焦点）
- [x] 窗口销毁时 `RemoveWindowSubclass`
- [x] 兜底入口（三选一）
  - [x] 托盘菜单"打开胶囊"
  - [ ] 或：全局快捷键
  - [ ] 或：启动期粗 rect 命中

### 后端：Tauri Commands

- [x] `avatar_update_hittest_mask`
  - [x] 参数：`seq, maskW, maskH, rect, bitsetBase64, viewportW, viewportH`
  - [x] 只保留最新 seq，丢弃过期
  - [x] sanity check：viewport 与 clientRect 差异告警
- [x] `open_capsule`
  - [x] 参数：`tab, anchorX, anchorY`
  - [x] 创建/显示 `ContextPanelWindow`
  - [x] 多显示器定位 + 边界 clamp
  - [x] emit `capsule-opened` 到 Panel

### 前端：AvatarWindow

- [x] 路由分发：根据窗口 label 渲染 `AvatarRoot` 或 `PanelRoot`
- [x] `MaskGenerator.ts`
  - [x] `scene.overrideMaterial` 渲染到小 RT
  - [x] `readPixels` → 二值化（alpha >= 32）
  - [x] 可选：膨胀 1–3px
  - [x] bitset 打包（y 翻转）→ base64
- [x] `useHitTestMask.ts`
  - [x] 兜底 10Hz 定时更新
  - [x] `invoke("avatar_update_hittest_mask", ...)`
  - [x] `visibilitychange` 监听：不可见时暂停
- [x] 右键交互
  - [x] `contextmenu` / `pointerdown(button=2)` 捕获
  - [x] `preventDefault()` + `invoke("open_capsule", ...)`

### 前端：ContextPanelWindow

- [x] `PanelRoot.tsx` 复用现有 Chat UI
- [x] 监听 `capsule-opened` 切换 tab（v0.1 先维护 activeTab 状态，v0.3 完整 Tabs UI）

### DoD v0.1

- [ ] 点模型像素 → 事件到达 Three.js
- [ ] 点透明区域 → 透传到底层窗口
- [ ] 右键模型 → 稳定唤出胶囊
- [ ] 胶囊可正常输入/交互
- [ ] AvatarWindow 点击不抢焦点
- [ ] mask 未就绪时仍有入口可用

---

## v0.2 — 交互更像桌宠

### 拖拽移动角色

- [x] 方案选择（二选一）
  - [x] Alt/Shift + 左键 → `HTCAPTION`（Windows 原生拖拽）
  - [ ] 前端拖拽 → invoke 移动窗口

### 动态 Mask 刷新

- [x] 检测条件
  - [x] motion active（跳舞/动作）
  - [x] pointer down（用户交互）
  - [x] 相机变化（Orbit/fit）
  - [x] 窗口 resize
- [x] 条件触发时提升到 30Hz

### Debug Overlay

- [x] 显示当前 bounding rect
- [x] 显示 mask 命中点
- [x] 显示刷新频率 / last update time

### DoD v0.2

- [ ] 可拖拽移动角色位置
- [ ] 跳舞时命中区域同步更新无明显延迟
- [ ] Debug overlay 可用于问题定位

---

## v0.3 — VRM/Debug 面板搬进胶囊

### Panel 拆分

- [x] Chat Tab（已有）
- [x] VRM Tab
  - [x] 动作列表/播放
  - [x] 表情控制（v0.3 先做 Emotion + intensity；精细 expression bindings 后续补）
  - [x] 工具模式切换
- [x] Debug Tab
  - [x] FPS 模式切换
  - [x] mouse tracking 参数（v0.3 先做 enabled 开关；细参后续补）
  - [x] HUD layout 开关（locked/editing）

### 命令总线

- [x] Panel → Rust → Avatar 事件路径
  - [x] `invoke("vrm_command", payload)`
  - [x] Rust 转发 `avatarWindow.emit("vrm-command", payload)`
  - [x] Avatar 监听并应用
- [x] 持久化配置走 `services::config`（Rust 单一真源）
- [x] 运行时命令走事件总线

### 状态同步（P1）

- [x] Panel 打开时拉取 Avatar 状态快照
  - [x] Rust emit `vrm-state-request`
  - [x] Avatar invoke `vrm_state_snapshot`
  - [x] Rust 转发给 Panel

### DoD v0.3

- [ ] VRM/Debug 面板完整可用于胶囊
- [ ] Panel 操作能正确控制 Avatar 行为
- [ ] Panel 打开时显示正确的当前状态

---

## P1 增强项（可穿插进行）

### 异步 Readback

- [ ] 评估 WebGL2 PBO 双缓冲
- [ ] 评估 OffscreenCanvas + Worker
- [ ] 替换同步 `readPixels`

### 边缘稳定性

- [ ] alpha 阈值调优（减少边缘闪烁）
- [ ] rect 时间滤波（指数平滑）
- [ ] 膨胀参数调优

### 多显示器 / 高 DPI

- [ ] `MonitorFromPoint` 正确选择显示器
- [ ] 胶囊贴边翻转逻辑
- [ ] 高 DPI（150%/200%）验证

---

## 测试矩阵

| 场景 | 状态 |
|------|------|
| 模型静止 - 点击命中 | [ ] |
| 模型静止 - 透明区域透传 | [ ] |
| 模型跳舞 - 命中跟随 | [ ] |
| 窗口 resize | [ ] |
| 高 DPI 150% | [ ] |
| 高 DPI 200% | [ ] |
| 多显示器 - 不同 DPI | [ ] |
| 刚启动 - mask 未就绪 | [ ] |
| 快速连续点击 | [ ] |
