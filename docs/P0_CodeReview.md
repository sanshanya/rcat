# P0 Code Review（对照 `docs/VRM_V1.md`）

## TL;DR

P0 之所以“代码看起来很多”，主要不是“补丁堆叠”造成的偶然复杂度，而是 **Windows + WebView2 + 透明顶层非激活窗口** 这个组合带来的必然工程成本：  
要同时满足 **像素级穿透**、**不抢焦点**、**右键唤出胶囊**、以及 **非激活窗口仍能可靠接收 Wheel/Drag**，必然需要一些 Win32 侧的 glue（subclass/全局 hook/轮询兜底）。

但当前实现确实有可收敛点：**把“桌宠交互”收口到 VRM renderer（已做）** 是正确方向；“命中/穿透”也已经收敛为 **cursor gate（`set_ignore_cursor_events` 动态切换）**，并移除 `WM_NCHITTEST` 路径，减少未来发散点。后续重点应放在 **DPI/坐标源统一** 与 **hook/轮询的生命周期与节流**。

---

## 1) 对照 `VRM_V1.md`：实现状态与对应代码

| `VRM_V1.md` 关键点 | 现状 | 代码位置（入口） |
|---|---|---|
| 两窗口职责：Avatar 渲染 / Panel 承载 UI | ✅ 符合 | `src/windows/WindowRouter.tsx` |
| 像素级穿透：模型像素可交互，透明区域穿透（cursor gate） | ✅（V1 仅保留 gate） | `src-tauri/src/windows/avatar_window.rs` + `src/windows/avatar/MaskGenerator.ts` |
| `WM_MOUSEACTIVATE = MA_NOACTIVATE` 不抢焦点 | ✅ | `src-tauri/src/windows/avatar_window.rs` |
| mask snapshot：低分辨率 bitset + rect + viewportW/H + seq 丢弃 | ✅ | `src/windows/avatar/useHitTestMask.ts` + `src-tauri/src/commands/avatar_commands.rs` + `src-tauri/src/windows/hittest_mask.rs` |
| 动态提频：交互/相机动/动作时 ~30Hz | ✅ | `src/windows/avatar/useHitTestMask.ts` |
| Panel show/hide：右键唤出、点外稳定隐藏 | ✅（Windows 侧做了兜底） | `src-tauri/src/windows/panel_window.rs` + `src-tauri/src/commands/panel_commands.rs` |
| Panel ↔ Avatar 命令总线/快照 | ✅ | `src-tauri/src/commands/vrm_commands.rs` + `src/windows/avatar/useAvatarVrmBridge.ts` |
| P0 风险：DPI/坐标系 sanity check | ✅ | `src-tauri/src/commands/avatar_commands.rs`（日志与校验） |
| “桌宠交互”：Wheel/Drag + Alt 分流 | ✅（已验证） | `src/components/vrm/useVrmRenderer.ts` + `src-tauri/src/windows/avatar_window.rs`（wheel hook） |

---

## 2) 复杂度来源：哪些是“必然复杂度”

### A. WebView2 多进程子窗口导致“无法全面 subclass”

你的日志里已经出现了典型现象：`EnumChildWindows` 枚举到的子窗口，有些属于 **其他 pid**（WebView2/Chromium 进程）。这些 HWND 无法在我们进程里 `SetWindowSubclass` 成功。

这意味着：单靠 `WM_NCHITTEST` 在“可 hook 的窗口”里做命中，在某些机器上 **不一定覆盖实际参与输入命中的那个窗口**，会导致“mask/红框正确但 OS 层不穿透/不可点”。  
因此 V1 已经选择收敛为 **cursor gate**：在 AvatarWindow 上动态切换 `ignore_cursor_events`，用“整窗 click-through”绕过不可控的子窗口结构差异。

### B. AvatarWindow 是非激活窗口：Wheel/Focus 事件天然不可靠

我们需要 `MA_NOACTIVATE` / `focusable(false)` 来保证“点击角色不抢走 IDE/浏览器键盘焦点”。  
副作用是：Windows 默认设置下，**非活动窗口经常收不到滚轮**（除非用户开启“滚动非活动窗口”）。

所以“想要桌宠缩放窗口/模型”必须要么：

- 改成会激活（违背 P0 要求），要么
- 用 Win32 全局输入兜底（`WH_MOUSE_LL` 捕获 wheel），然后转发给前端（当前实现）。

### C. Panel 的 blur/focus 在 MA_NOACTIVATE 场景下会抖

当 avatar 不激活、panel 又试图抢前台/置顶时，Windows 的 focus-stealing 规则会出现各种 “focus bounce”。  
只靠前端 `blur` 隐藏 panel 在 Windows 上会不稳定，因此你会看到我们用“点外隐藏”的兜底。

当前收敛方向：**Windows mini 模式不再依赖 blur 自动隐藏**，统一由 Win32 全局鼠标 hook 做 outside-click dismiss，避免拖拽/缩放/弹窗导致的假 blur。

结论：**这些额外代码不是“补丁堆叠”，而是 OS 约束的显式成本**。

---

## 3) 当前实现的“会成为阻碍”的点（风险清单）

### 3.1 gate 目标 HWND/坐标源不一致（仍需重点验证）

cursor gate 的正确性依赖两个前提：

- `ScreenToClient/GetClientRect` 必须基于“与 WebView 输入坐标一致”的那个 HWND（常见是 WebView2 子窗口，而不是顶层 HWND）。
- 高 DPI/有标题栏/多显示器下，window/client/viewport 的比例变化要可观测且不会刷屏。

当前实现已通过“选择最大子 HWND 作为 gate 目标 + 不一致时刷新”的方式收敛风险，但仍建议在 150%/200% DPI 与多显示器环境下做回归验证。

### 3.2 多个全局轮询/定时器（33ms/16ms）

目前存在：

- cursor gaze emitter（33ms）
- avatar cursor gate（33ms）
- wheel router（16ms，现也负责 panel 点外隐藏事件路由）

这在 demo 机器上通常没问题，但会增加“未来调优/省电/CPU”的工作量，也让行为更难推断。

建议：保持“全局输入兜底”只在一处收口，避免再引入新的 ticker（例如 panel 点外隐藏不应另起轮询）。

### 3.3 全局 hook 的生命周期与可控性

全局 hook 最怕：

- 多次安装/卸载不一致导致泄漏
- App 进入托盘仍在 hook，用户以为“程序关了”但 hook 仍在

建议：明确 hook 的生命周期策略（例如“只要 avatar window 存在就保持安装”，或“toolMode=avatar 才安装”），并在文档/日志里固定输出。

---

## 4) 建议的收敛路线（让它不会成为未来阻碍）

### Step 1：输入兜底收口为一个模块（建议做）

把 Windows 的 `WH_MOUSE_LL` 做成单一模块，统一处理：

- wheel（已做）
- left click（用于 panel outside-dismiss，已做）
-（可选）right click / ESC 等（未来增强）

收益：

- 去掉 `panel_window.rs` 的 33ms 轮询
- 所有“全局输入兜底”在一个地方，便于后续开关与排障

### Step 2：命中策略只保留一个“主路径”

V1 已选择 **方向 B**：主用 gate（`ignore_cursor_events`），只保留最小 subclass（`MA_NOACTIVATE`）与输入兜底 hook。`WM_NCHITTEST` 路径已移除，避免双轨长期发散。

### Step 3：把常量/阈值集中到一个地方

目前分散在 TS/Rust 多处（mask maxEdge、alphaThreshold、interval、scale bounds…）。  
建议建立：

- 前端 `src/windows/avatar/config.ts`
- 后端 `src-tauri/src/windows/avatar_config.rs`（或常量块）

统一含义，避免未来“调一个数字要改四处”。

---

## 5) “更少代码”的终极方案（如果未来要做 v1.0）

如果目标是把 Win32 glue 大幅减少，只有一条路：**把 Avatar 渲染从 WebView2 挪出去**（例如 wgpu/DirectX 的 native window）。  
这样可以：

- 更好控制 layered window / per-pixel alpha 与 hit test
- 直接在 native 层处理输入，不需要跨进程子窗口/全局 hook 的折衷

但这已经超出 V1 demo 的范围，属于 “稳定产品化” 的架构投资。

---

## 6) 明日建议 TODO（最小成本收敛）

1. ✅ 把 panel outside-dismiss 从轮询改为 hook（复用 `WH_MOUSE_LL`）。  
2. 回归验证 gate：150%/200% DPI、多显示器（不同 DPI）、以及“有标题栏 debug 模式”。  
3. 继续完善日志节流：只在“异常/变化”时输出，避免 hot-reload 后刷屏。  
