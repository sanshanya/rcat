# P0 Code Review（对照 `docs/VRM_V1.md`）

## TL;DR

P0 之所以“代码看起来很多”，主要不是“补丁堆叠”造成的偶然复杂度，而是 **Windows + WebView2 + 透明顶层非激活窗口** 这个组合带来的必然工程成本：  
要同时满足 **像素级穿透**、**不抢焦点**、**右键唤出胶囊**、以及 **非激活窗口仍能可靠接收 Wheel/Drag**，必然需要一些 Win32 侧的 glue（subclass/全局 hook/轮询兜底）。

但当前实现确实有可收敛点：**把“桌宠交互”收口到 VRM renderer（已做）** 是正确方向；下一步应把“输入兜底（wheel + outside-click）”收口到单一 Win32 hook 模块，并明确 **命中/穿透的主策略**（`WM_NCHITTEST` vs `ignore_cursor_events` gate），避免双轨逻辑未来发散。

---

## 1) 对照 `VRM_V1.md`：实现状态与对应代码

| `VRM_V1.md` 关键点 | 现状 | 代码位置（入口） |
|---|---|---|
| 两窗口职责：Avatar 渲染 / Panel 承载 UI | ✅ 符合 | `src/windows/WindowRouter.tsx` |
| 像素级穿透：模型像素 HTCLIENT，外部 HTTRANSPARENT | ✅（但存在“兜底 gate”双轨） | `src-tauri/src/windows/avatar_window.rs` + `src/windows/avatar/MaskGenerator.ts` |
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

这意味着：单靠“对子窗口逐个 subclass + WM_NCHITTEST”在某些机器上 **不一定覆盖实际参与输入命中的那个窗口**。因此才会出现：

- 明明 mask/红框正确，但红框外仍然“偶发不穿透”

对应的工程手段只能二选一（或混合）：

1) **`WM_NCHITTEST` 路径尽量覆盖**（对能 hook 的窗口）  
2) **`ignore_cursor_events` gate**：在顶层窗口上切换 `WS_EX_TRANSPARENT`，用“整窗透明”绕过无法 subclass 的子窗口（当前实现即此）。

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

### 3.1 双轨命中策略：`WM_NCHITTEST` + cursor gate

这会带来长期风险：

- 两套坐标映射/窗口选择逻辑容易漂移（尤其是 DPI/多显示器、WebView 结构变化时）。
- Debug 时不容易定位“到底是 WM_NCHITTEST 在生效还是 gate 在生效”。

建议：把它变成“**一个主策略 + 一个可显式开启的 fallback**”，而不是默认两套都跑。

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

两个可行方向：

- **方向 A（更精确）**：主用 `WM_NCHITTEST`，gate 只在检测到“当前 HWND 结构无法 hook”时启用（或通过 debug 开关启用）。  
- **方向 B（更简单）**：主用 gate（`ignore_cursor_events`），只在 titlebar/debug 时保留最小的 subclass（`MA_NOACTIVATE`）。  

建议先做“可切换”：

- `RCAT_AVATAR_HITTEST_MODE=nchittest|gate|hybrid`

先用真实用户机器跑一周，确认哪个在你们目标环境下更稳，再删掉另一条路径。

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
2. 为命中策略加运行时开关（`gate/nchittest/hybrid`），并加一条 debug 日志显示当前模式。  
3. 做一个“WM_NCHITTEST 是否实际命中”的计数器/节流日志（避免刷屏），用于判断能否删掉 gate。  
