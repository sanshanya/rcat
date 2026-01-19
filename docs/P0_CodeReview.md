# P0 Code Review（对照 `docs/VRM_V1.md`）

## TL;DR

P0 之所以“代码看起来很多”，主要不是“补丁堆叠”造成的偶然复杂度，而是 **Windows + WebView2 + 透明顶层非激活窗口** 这个组合带来的必然工程成本：  
要同时满足 **像素级穿透**、**不抢焦点**、**右键唤出胶囊**、以及 **非激活窗口仍能可靠接收 Wheel/Drag**，必然需要一些 Win32 侧的 glue（subclass/全局 hook/轮询兜底）。

但当前实现确实有可收敛点：**把“桌宠交互”收口到 VRM renderer（已做）** 是正确方向；“命中/穿透”也已经收敛为 **cursor gate（`set_ignore_cursor_events` 动态切换）**，并移除 `WM_NCHITTEST` 路径，减少未来发散点。后续重点应放在 **DPI/坐标源统一** 与 **hook/轮询的生命周期与节流**。

---

## Update（2026-01）

- ✅ 胶囊定位 anchor 坐标源收敛：Avatar 右键召唤改为后端 `GetCursorPos`（规避 WebView2/DPI/多显示器坐标坑）
- ✅ P1 “可观测/可调参”补齐：DebugTab 增加 alphaThreshold/dilation/maxEdge/rectSmooth + overlay 显示 `gen≈Xms`
- ✅ 增加 DPI 排查指标：overlay 显示 `viewport/client mismatch` 计数与 last dims（用于验证 150%/200%）
- ✅ “小红点”可控：支持开关（debug 阶段保留，默认可关）
- ✅ TS “减山”：`useVrmBehavior` 拆为一组 controller（`IdleMotionController/EmotionMotionCoordinator/AvatarGazeController/BlinkController`），hook 只做装配与调度
- ✅ TS “减山”：`useVrmRenderer` 进一步拆分为 `vrmLoaderRuntime/vrmRenderLoop/vrmSceneUtils/vrmRendererTypes`，减少“上帝 hook”耦合
- ✅ 修复动作播放“模型飘走/跳位”：明确 root motion policy（in-place）——播放前以当前 hips 为基准重写 `Hips.position` 轨（锁 X/Z、保留 Y 相对变化），避免动作自带位移把模型带离窗口（V2 可把 delta 提取出来驱动窗口/locomotion）。见 `src/components/vrm/motion/desktopRootMotion.ts`
- ✅ 修复 VRMA translation 转换：不再对 translation 应用完整 world matrix（会注入 parent translation 导致漂移），只应用 rest rotation。见 `src/components/vrm/motion/vrma/VRMAnimationLoaderPlugin.ts`
- ✅ FBX（Mixamo）脚滑治理：VMD 轨自带 IK target + `VRMIKHandler`，而 FBX 是纯 FK retarget，新增轻量 foot-plant IK（仅在 `type=fbx` 时启用）以减少“站不稳/腿飘”。见 `src/components/vrm/motion/footPlantIk.ts`
- ✅ 修复 FBX↔VMD 切换顺序依赖：跨 motion type 切换时 `stopAllAction + uncacheRoot + resetNormalizedPose`，并补全 sparse clip 的 humanoid tracks（含 `hips.position`），避免 “先播谁” 导致脚漂/错位。见 `src/components/vrm/motion/MotionController.ts`
- ✅ Win32 glue “减山”：`avatar_window` 收敛为 `subclass` + `service`（cursor gate + `WH_MOUSE_LL` 统一 owner，职责清晰、便于拓展与排障）
- ✅ VRM 命令总线更稳：Rust 侧引入 `VrmCommandPayload/VrmStateSnapshot` 结构化载荷（保留 forward-compat 的同时避免纯 `Value`）
- ✅ 修复 AvatarWindow 缩放“跳回原位”：窗口 move/scale 从 `useVrmRenderer` 拆到 `AvatarWindowTransformController`，统一队列与缓存失效策略
- ✅ P1 异步 readback：WebGL2 PBO + fence（默认启用，可在 DebugTab 关闭；失败自动回退 sync）
- ✅ cursor gate 失败策略收敛：异常时 fail-open 到 click-through（避免“整窗挡鼠标”）
- ✅ Win32 坐标映射去重：`screen→client→mask` 逻辑收口为 `map_screen_to_avatar_client`，cursor gate / 全局 hook 共用
- ✅ 前端 hitTest settings 去重：`hittestDebugSettings.ts` 统一 resolve/apply/storage，DebugTab/AvatarRoot 复用并以 patch 事件同步

## 1) 对照 `VRM_V1.md`：实现状态与对应代码

| `VRM_V1.md` 关键点 | 现状 | 代码位置（入口） |
|---|---|---|
| 两窗口职责：Avatar 渲染 / Panel 承载 UI | ✅ 符合 | `src/windows/WindowRouter.tsx` |
| 像素级穿透：模型像素可交互，透明区域穿透（cursor gate） | ✅（V1 仅保留 gate） | `src-tauri/src/windows/avatar_window/service.rs` + `src-tauri/src/windows/hittest_mask.rs` + `src/windows/avatar/MaskGenerator.ts` |
| `WM_MOUSEACTIVATE = MA_NOACTIVATE` 不抢焦点 | ✅ | `src-tauri/src/windows/avatar_window/subclass.rs` |
| mask snapshot：低分辨率 bitset + rect + viewportW/H + seq 丢弃 | ✅ | `src/windows/avatar/useHitTestMask.ts` + `src-tauri/src/commands/avatar_commands.rs` + `src-tauri/src/windows/hittest_mask.rs` |
| 动态提频：交互/相机动/动作时 ~30Hz | ✅ | `src/windows/avatar/useHitTestMask.ts` |
| Panel show/hide：右键唤出、点外稳定隐藏 | ✅（Windows 侧做了兜底） | `src-tauri/src/windows/panel_window.rs` + `src-tauri/src/commands/panel_commands.rs` |
| Panel ↔ Avatar 命令总线/快照 | ✅ | `src-tauri/src/commands/vrm_commands.rs` + `src/windows/avatar/useAvatarVrmBridge.ts` |
| P0 风险：DPI/坐标系 sanity check | ✅ | `src-tauri/src/commands/avatar_commands.rs`（日志与校验） |
| “桌宠交互”：Wheel/Drag + Tool 模式分流（Pet/Model/Camera） | ✅（已验证） | `src/components/vrm/useVrmRenderer.ts` + `src/components/vrm/vrmLoaderRuntime.ts` + `src/components/vrm/vrmRenderLoop.ts` + `src-tauri/src/windows/avatar_window/service.rs`（wheel hook） |
| P1：mask 阈值/膨胀/rectSmooth 可调 | ✅ | `src/windows/panel/tabs/DebugTab.tsx` + `src/windows/avatar/useHitTestMask.ts` |
| P1：DPI mismatch 可观测 | ✅ | `src-tauri/src/commands/avatar_commands.rs` + `src-tauri/src/windows/avatar_window/service.rs` + `src/windows/avatar/HitTestDebugOverlay.tsx` |
| VRM 命令/快照载荷结构化 | ✅ | `src-tauri/src/commands/vrm_types.rs` + `src-tauri/src/commands/vrm_commands.rs` |
| Win32 glue 拆分（subclass/gate/hook） | ✅ | `src-tauri/src/windows/avatar_window/` |

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

### 3.4 窗口变换的“单一真源”问题（这次跳位 bug 的根因）

现象：Avatar 模式下把窗口拖到右边后，滚轮缩放会“跳回旧位置/初始位置”。

根因不是缩放公式错，而是 **窗口 transform 有多个来源**：

- JS 侧 `setPosition/setSize`（拖拽/缩放）
- OS 侧移动（debug 标题栏拖动、系统对齐/吸附）
- DPI/缩放变化（WebView2/Tauri 触发的 `onScaleChanged/onResized`）

当我们在前端缓存了 `outerX/outerY/outerW/outerH/borderW/borderH`，而窗口被“外部移动”后 cache 仍是旧值，下一次缩放围绕旧中心计算 `nextOuterX/Y`，自然会看起来“跳回原位”。

收敛方式：把 **窗口 move/scale + metrics cache** 收口为单一模块 `src/components/vrm/avatarWindowTransform.ts`：

- 统一序列化（单 runner）：move/scale 不再并发，避免竞态
- `onMoved/onResized/onScaleChanged` → metrics cache 失效，避免“旧中心”参与计算
- `useVrmRenderer` 只负责“桌宠交互意图”（Wheel/Drag + Tool 模式分流），不再直接管理 window metrics

这类 bug 的本质是“缺少 WindowTransform 的单一真源”，越早抽离越不容易在后续扩展（更多手势/更多窗口模式）时反复踩坑。

### 3.5 动作播放时“模型漂移/下沉/上跳”：根因不是 hitTest，而是 root motion

现象（用户截图）：播放某些动作时，模型会慢慢“走丢”，甚至只剩脚在角落，mask red rect 也跟着跑偏。

根因：在 three-vrm 的 normalized rig 上，`Hips` 是 humanoid 的“根”。  
当动画 clip 含有 `Hips.position`（translation）轨时，它在语义上属于 **root motion（位移）**：本来用于走路/移动角色。  
但桌宠 AvatarWindow 的坐标系是“窗口内固定”，不允许动画直接把根骨带着整体位移，否则：

- 角色会跑出窗口视野（你看到的下沉/上跳/漂移）
- hit-test mask 的矩形与模型不再同步，造成交互错位

V1 的收敛方式是把它显式变成一个策略：**in-place root motion**。  ![1768841712846](image/P0_CodeReview/1768841712846.png)
在每次 `play()` 时，以当前 `Hips.position` 为基准，把 `Hips.position` 轨重写为：

- `x/z` 固定为 baseline（防漂移）
- `y` 保留相对变化（动作中的蹲起/跳跃仍能表现）

这样我们不是“防下沉补丁”，而是把“能不能动、轴心在哪、坐标系谁说了算”明确下来：  
**桌宠坐标系（窗口）为真源，root motion 不能直接驱动角色根位移**；未来 V2 可以把被剥离的 delta 用来驱动窗口移动或 locomotion。

### 3.6 FBX↔VMD 切换后脚漂移/错位：根因是 AnimationMixer 绑定基线 + sparse tracks

现象（你描述的复现序列）：

- 初始化后直接播 `female_happy`（FBX）脚很稳
- 切到 `female_stand`（VMD）脚位置不对/整体下沉或上跳
- 再切回 `female_happy`（FBX）脚开始漂
- 再切 VMD 又变回“正常/稳定”

这类“顺序依赖”的根因通常不是 foot-plant 或某个阈值，而是 **Three.js AnimationMixer 的 binding/originalState 捕获时机** 与 **clip 缺失 tracks 导致的状态泄漏**：

- `mixer.clipAction(clip)` 在第一次绑定某个 property（比如 `hips.position`、`leftToes.quaternion`、以及 VMD 用的 `leftFootIK.position`）时，会把当时的值记为“original state”
- 如果你在 **另一个动作正在播放（甚至 IK target 正在被驱动）** 的时候创建/绑定新 action，就可能把一个“非静止态”的值当成 original state
- sparse clip（缺少某些 bone/IK target 的 track）会依赖这个 original state，于是出现“先播谁就变成谁的基线”的漂移/错位

V1 的收敛策略：

- 跨 motion type（FBX/VRMA/VMD/embedded）切换：**先清空 mixer cache（stopAllAction + uncacheRoot）并 resetNormalizedPose，再创建 action**
- 同时把 sparse clip 缺的 humanoid tracks 用 rest pose 补齐（含 `hips.position`），让“没有 track 就沿用旧值”的路径彻底消失

#### Debug 方法（把问题变成可验证）

1. 打开 panel → Debug → **Motion Logs = Enabled**
2. 复现：`female_happy(fbx) → female_stand(vmd) → female_happy(fbx) → female_stand(vmd)`
3. 打开 WebView DevTools Console，贴出这些日志块：
   - `[motion] play ...`（看 `didHardReset`、`trackCoverage(normalized)`、`hips.position(track)`）
   - `[motion] snapshot ...`（看 normalized/raw/targets 的 world position 是否出现突变）
   - `[mixamo] retarget scale ...`、`[vmd] offsets(from normalizedRestPose) ...`（验证加载阶段是否依赖当前 pose）

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
建议建立（hitTest 的默认值/调参已部分收口到 `src/windows/avatar/hittestDebugSettings.ts`，`MaskGenerator.ts` 也复用该常量）：

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
![1768801061110](image/P0_CodeReview/1768801061110.png)
