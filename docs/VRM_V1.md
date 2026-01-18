# VRM V1（Windows-only Demo）：AvatarWindow + ContextPanelWindow 改造计划

本文描述一套**以 VRM 桌宠观感为优先**、在 **Windows-only 出 demo / 追效果** 约束下工程上可控的改造方案。

核心思路：

- **AvatarWindow**：只负责渲染 VRM（全透明顶层窗口），默认 click-through（事件透传），通过 **cursor gate（`set_ignore_cursor_events` 动态切换）** 让“仅模型像素”恢复交互。
- **ContextPanelWindow（胶囊）**：复用现有 Chat UI，并新增 VRM/Debug 面板；由模型右键唤出、可输入可点击，不参与穿透判定。

> 更新（2026-01）：在 WebView2 多进程/子窗口结构下，`WM_NCHITTEST` 路径在部分机器上无法稳定覆盖“实际参与命中的 HWND”。因此 V1 主策略改为 **cursor gate（`set_ignore_cursor_events` 动态切换）**，并移除 `WM_NCHITTEST` 相关实现。

术语约定（避免混用）：

- **ContextPanelWindow**：代码层窗口名（Tauri label/后端逻辑）。
- **胶囊 / Panel**：产品/交互层称呼，指 ContextPanelWindow。
- **AvatarWindow**：代码层窗口名，指承载 VRM WebGL 的透明窗口。

里程碑命名：

- 文档标题里的 “V1” 指代这条方案主线；实现迭代建议按 `v0.1/v0.2/v0.3` 滚动推进，预留 `v1.0` 给“正式 release”。

> 关联背景/现状见 `docs/VRM.md`（当前 VRM 皮肤实现）与 `implementation_plan.md`（click-through 相关约束/修正）。

---

## 0. 目标与非目标

### 目标（V1 必达）

- **桌面穿透手感正确**：AvatarWindow 在“模型像素外”从 OS 视角等同不存在（鼠标事件透传到底层窗口）。
- **模型可交互**：模型像素处可收鼠标事件，Three.js raycast 正常工作；右键能稳定唤出胶囊。
- **工程可控**：不引入复杂几何命中（BVH/逐三角）到 Rust 侧；Rust 侧仅做 O(1) 内存查询 + `ignore_cursor_events` 切换。
- **对“跳舞/移动”成立**：模型轮廓随动画变化时，命中区域同步更新，不出现大量误吃点击或漏点。

### 非目标（V1 不做/不保证）

- 跨平台（macOS/Linux）：本方案明确 **Windows-only**。
- 完美几何命中：V1 以“像素级可点”作为交互定义，不追求“被遮挡骨骼仍可点”等高级语义。
- 低端机器极致优化：V1 优先可用与可控；性能只要在 demo 机器上稳定即可。

### 审阅要点（P0 / P1）

P0（不做很容易翻车）：

- **命中坐标系对齐**：后端命中映射必须对齐到前端 WebGL 的“绘制缓冲区像素”（`drawingBufferWidth/Height`），并在 IPC 里传递必要元数据做 sanity check。
- **AvatarWindow 不抢焦点**：必须处理 `WM_MOUSEACTIVATE`（建议 `MA_NOACTIVATE`），避免用户点角色时 IDE/浏览器失去键盘焦点。
- **命中用的 HWND 必须正确**：cursor gate 的 `ScreenToClient/GetClientRect` 要对准实际接收输入的子 HWND（可能不是顶层 HWND）；优先 `SetWindowSubclass`，并在销毁时移除。
- **mask 未就绪的兜底入口**：坚持“缺数据就透明”没问题，但 V1 必须提供至少一个可操作入口（托盘/启动期粗命中；本项目不做快捷键）。

P1（增强稳定性与观感）：

- **异步 readback**：预留 WebGL2 PBO 或 OffscreenCanvas/Worker 路径，降低 `readPixels` 引发的 GPU-CPU 同步抖动风险。
- **阈值/抖动治理**：alpha 阈值、轻量膨胀与 rect 时间滤波，避免边缘闪烁导致命中不稳。
- **Panel ↔ Avatar 状态同步**：Panel 打开时能拿到 Avatar 当前工具模式/动作等运行时状态（快照请求/订阅更新）。

---

## 1. 总体架构

### 1.1 两窗口职责划分

#### AvatarWindow（渲染层）

- 仅渲染 VRM：`<canvas>` + 运行时渲染/行为系统（Three.js + three-vrm）。
- 窗口层面：透明、置顶、跳过任务栏；不承载输入框/列表等 UI。
- 命中策略：Rust cursor gate 做 **(粗) bounding rect + (细) mask bitset** 两级判定，并动态切换 `set_ignore_cursor_events(true/false)`。

#### ContextPanelWindow（交互层/胶囊）

- 承载 Chat + VRM/Debug 面板（“产品 UI”集中在这里）。
- 可聚焦、可输入；显示/隐藏由 AvatarWindow 的右键交互触发。
- 不做穿透（或仅在特定模式下做轻量穿透，但不是 V1 目标）。

> 直观效果：桌面上“只有角色本身会挡鼠标”，而 UI 胶囊是明确的、可交互的独立窗口。

### 1.2 前端路由/渲染入口建议

为避免维护两套前端工程，建议使用**同一套 bundle**，根据当前窗口 label 渲染不同根组件：

- `avatar` → `AvatarRoot`（只挂 VRM 舞台与命中 mask 生成器）
- `panel` → `PanelRoot`（Chat + Tabs：Chat/VRM/Debug）

实现方式（建议）：

- 通过 `@tauri-apps/api/webviewWindow` 获取当前窗口 label（或由后端注入 query 参数）。
- Root 只做一次分发，不引入复杂多页面构建。

---

## 2. 交互链路（端到端）

### 2.1 AvatarWindow 命中/穿透策略（cursor gate）

AvatarWindow 使用 `set_ignore_cursor_events(true/false)` 做“整窗是否吃鼠标”的开关：

- 默认保持 `ignore_cursor_events=true`（整窗 click-through，事件透传到底层窗口）。
- 后端 cursor gate 后台轮询鼠标位置：
  - 鼠标位于“模型像素”（mask 命中）时：切为 `ignore_cursor_events=false`（让 WebView/Three.js 收到事件，右键可 `preventDefault()`）。
  - 鼠标位于“模型像素外”时：切回 `ignore_cursor_events=true`（不再出现“透明矩形挡点击”）。

同时（P0 推荐 V1 就做）：

- **禁止激活抢焦点**：在 subclass 里处理 `WM_MOUSEACTIVATE` 返回 `MA_NOACTIVATE`，避免用户点角色时打断 IDE/浏览器输入。

可选（V1.1 以后再评估）：

- “拖拽移动角色”建议走前端拖拽 + 后端移动窗口（避免引入 `HTCAPTION` 依赖）。

> 注意：不要让 `ignore_cursor_events=false` 常驻，否则窗口会变成一个“透明矩形挡点击”。它必须严格由 mask 决定、随光标动态切换。

### 2.2 右键唤出胶囊（ContextPanelWindow）

前端（AvatarWindow）：

1. 在模型命中时捕获右键（`contextmenu` 或 `pointerdown(button=2)`）。
2. `preventDefault()`，并通过 Tauri `invoke` 发送：
   - `open_capsule({ anchor, tab })`
   - `anchor` 建议用 **屏幕坐标**（或让后端 `GetCursorPos` 读取）
   - `tab` 可选：`"chat" | "vrm" | "debug"`

后端：

- 创建/显示/定位 `ContextPanelWindow`
- 置顶但“少抢焦点”：
  - 第一次打开可聚焦输入框
  - 之后打开尽量避免抢焦点（必要时用 Windows API 做 `SWP_NOACTIVATE` / `MA_NOACTIVATE`）

定位补充（多显示器/贴边翻转）：

- Monitor 选择：使用 `MonitorFromPoint(anchor)`（而不是仅用主显示器边界）。
- 贴边策略：当角色靠近屏幕边缘时，胶囊应支持“翻转到另一侧”显示。
- 建议明确 anchor 语义：`{ x, y, preferDirection: "right" | "left" }`（方向仅作偏好，最终仍需 clamp）。

---

## 3. 成败点：如何“优秀”地判定模型区域

V1 推荐方案：**GPU 轮廓 Mask + 二级判定**（准 + 快 + 工程可控）。

### 3.1 两级判定（既准又快）

第一级：**粗判定 bounding rect**（快速拒绝绝大多数点）

- 来自 mask 的非零像素 bounding rect（比“投影 3D AABB”更稳，跳舞/SkinnedMesh 不漏手脚）。
- 点不在 rect 内：直接 `HTTRANSPARENT`。

第二级：**细判定 mask bitset**（避免 rect 内透明区域误吃点击）

- 维护一个低分辨率二值 mask（例如最大边 160，按窗口比例自适应另一边）。
- 点映射到 mask 像素，查 bit=1 → `HTCLIENT`，否则 `HTTRANSPARENT`。

### 3.2 Mask 如何生成（前端 WebGL 最省心）

基本原则：**再渲染一次模型到小 RT**，只输出“模型=白、背景=透明”，不做贴图/光照。

建议实现（three.js）：

- **首选（更简洁）**：`scene.overrideMaterial = new MeshBasicMaterial({ color: 0xffffff })`
- **备选**：遍历模型 Mesh 临时替换 material（当 overrideMaterial 与某些材质/后处理冲突时用）
- `renderer.setRenderTarget(maskRT)` + `renderer.clear()` + `renderer.render(scene, camera)`
- 渲染后恢复 renderer 状态（`setRenderTarget(null)`、`scene.overrideMaterial = null` 等），避免影响主渲染
- `readPixels` 读回小图（RGBA）
- 二值化（建议阈值化而不是 `>0`）：例如 `alpha >= 32` 视为 1，降低抗锯齿边缘闪烁带来的命中抖动
- 可选：轻量膨胀（dilation）扩大 1–3 像素，提升易点性（也能部分抵消 mask 更新时延）
- 可选：rect 时间滤波（指数平滑）避免 bounding rect 抖动导致“可点区域跳动”
- 压缩：按位打包成 bitset（1 bit / pixel）

尺寸建议：

- `maskW * maskH` 目标在 **~30k–60k 像素**量级（例如 160×210 这种随比例变化的大小）
- 每帧 `readPixels` 可能 stall GPU（GPU-CPU 同步点）；V1 先用同步方案跑通，但架构上应预留异步 readback 的替换点（见下）。

异步 readback（P1，降低抖动风险）：

- WebGL2：Pixel Buffer Object（PBO）双缓冲/环形队列做异步 `readPixels`，在后续帧 `getBufferSubData`/映射读回。
- OffscreenCanvas：把 mask 渲染与 `readPixels` 放到 Worker（需要 OffscreenCanvas 支持），主线程只收 bitset。

### 3.3 更新频率策略（让“跳舞/移动”仍成立）

推荐：**低频兜底 + 动态加速**

- 兜底：2–10Hz 定时刷新（保证长期不漂移）
- 动态：当以下任一成立时提高到 ~30Hz（或每帧）：
  - 正在播放动作/跳舞（motion active）
  - 用户正在拖拽/交互（pointer down）
  - 相机在动（Orbit/fit）
  - 窗口大小变化（resize）

补充（窗口不可见时暂停）：

- AvatarWindow 隐藏/最小化/`document.visibilityState !== "visible"` 时暂停 mask 更新，恢复可见后再 resume。

关键点：cursor gate 只读最近一次 mask，因此刷新频率只影响“命中边界的时延”，不会阻塞系统消息处理。

---

## 4. 后端实现要点（Windows / Rust / Tauri）

### 4.1 需要做什么（核心）

1. 获取 AvatarWindow 的 `HWND`。
2. 安装 Windows subclass（优先 `SetWindowSubclass`），拦截 `WM_MOUSEACTIVATE`（不抢焦点）。
3. 启动 cursor gate（后台轮询）：执行纯内存判断（O(1)）并切换 `ignore_cursor_events`。
4. 提供 Tauri command，用于前端推送 mask snapshot 到后端缓存（只保留最新 seq）。
5. 在窗口销毁时移除 subclass（避免残留回调/崩溃）。

### 4.2 cursor gate 必须满足的约束

- **绝不等待前端**：不能 `invoke` 回 JS，更不能同步 IPC。
- **绝不阻塞**：避免锁竞争；推荐 `ArcSwap` 或 `RwLock::try_read()`。
- **常数时间**：少量整数运算 + 一次 bitset 访问。
- **缺数据就 click-through**：mask 还没到/读取失败时保持 `ignore_cursor_events=true`（宁可暂时点不到模型，也不要“整窗挡鼠标”）。

缺数据就透明的同时（P0）必须给“可操作兜底入口”：

- 托盘菜单新增“打开胶囊”（本项目不做快捷键），确保启动初期/异常时用户仍能打开 Panel。
- 或在启动后前 N 秒临时启用“粗 rect 命中”（允许右键打开胶囊），首个 mask 到达后切到像素级判定。

### 4.3 Hook/Subclass 时机与 HWND 确认（P0）

Tauri/winit + WebView2 在 Windows 上可能存在“外层顶级 HWND + WebView 子 HWND”的结构，必须确认你拦截的是实际参与命中的窗口。

建议：

- 获取 `HWND`：通过 `raw_window_handle`（winit）或 Tauri 提供的窗口句柄接口。
- 安装方式：优先 `SetWindowSubclass`（比 `SetWindowLongPtr(GWLP_WNDPROC)` 更安全，且便于链式调用）。
- DoD：输出日志（HWND、window class、cursor gate 目标 HWND），必要时对子窗口也安装 subclass，确保 `WM_MOUSEACTIVATE` 一致生效。
- 移除时机：在 `Destroyed`（或等价生命周期事件）中 `RemoveWindowSubclass`。

### 4.4 建议的数据结构（示意）

后端缓存一个不可变快照：

- `mask_w, mask_h`
- `rect_min_x, rect_min_y, rect_max_x, rect_max_y`（mask 像素坐标）
- `bitset: Vec<u8>`（按行，1 bit / pixel）
- `viewport_w, viewport_h`（前端 WebGL drawing buffer 尺寸；用于 DPI/缩放 sanity check）
- `seq`（前端递增，用于丢弃过期更新）

在 cursor gate 中（示意）：

- `ScreenToClient` 得到 `x/y`（client px）
- `GetClientRect` 得到 `clientW/H`（同一坐标系；可能受 DPI 虚拟化影响）
- （可选）映射到 WebGL viewport px：`vx = x * viewport_w / clientW`，`vy = y * viewport_h / clientH`
- `mx = vx * mask_w / viewport_w`，`my = vy * mask_h / viewport_h`
- `if !rect.contains(mx,my) => ignore_cursor_events=true`
- `bit = bitset[my * stride + mx/8] >> (mx%8) & 1`
- `bit==1 ? ignore_cursor_events=false : ignore_cursor_events=true`

> 坐标系建议：mask 以“左上角为原点”；注意 WebGL `readPixels` 是左下角原点，前端打包 bitset 前需要翻转 y。
>
> P0 原则：后端命中映射必须与前端 mask 的 viewport 语义一致。最稳妥做法是：前端上报 `drawingBufferWidth/Height`（以及可选的 canvas client 物理尺寸）给后端做 sanity check；当差异异常时记录日志并降级（例如临时只用粗 rect 或直接透明）。

---

## 5. IPC 设计（前端 ↔ 后端 ↔ 多窗口）

### 5.1 命中 mask 推送（AvatarWindow → Rust）

推荐使用 Tauri command（示意）：

- `avatar_update_hittest_mask({ seq, maskW, maskH, rect, bitsetBase64, viewportW, viewportH, clientW?, clientH?, dpr? })`

为什么建议 base64：

- bitset 体积很小（几十 KB 以内）
- 避免把 `Uint8Array` 序列化成“超长 number 数组”（JSON 会非常臃肿）

传输与缓存策略（建议写死约束，避免后期踩坑）：

- 尺寸上限：限制 mask 最大边（例如 `max(maskW,maskH) <= 320`），避免误配置导致 IPC 激增。
- 丢弃旧数据：后端仅保留最新 `seq`（新 seq 到来直接覆盖，避免排队堆积）。
- sanity check：`viewportW/H` 与后端 `GetClientRect` 差异过大时输出日志（用于定位 DPI/缩放/布局问题）。

### 5.2 胶囊打开（AvatarWindow → Rust → Panel）

命令（示意）：

- `open_capsule({ tab, anchorX, anchorY })`

后端职责：

- 确保 `ContextPanelWindow` 存在
- 根据 anchor 定位并 clamp 到虚拟桌面边界（可复用 `src-tauri/src/window_state.rs` 的边界计算思路）
- `show + setAlwaysOnTop +（可选 focus）`
- 向 `ContextPanelWindow` emit：`capsule-opened({ tab })`（用于前端切换 tab）

### 5.3 Panel 对 VRM/Debug 的控制（Panel → Rust → Avatar）

原则：Panel **不直接持有** VRM 实例（它在 AvatarWindow 的 WebGL 上下文里），因此需要“命令总线”：

- Panel `invoke("vrm_command", payload)` → Rust → `avatarWindow.emit("vrm-command", payload)`
- AvatarWindow 监听 `"vrm-command"` 并应用到本地 store（如 `vrmToolModeStore`、debug 开关等）

V1 分层建议：

- “持久化配置类”（FPS mode、mouse tracking 参数、hudLayout 等）继续走现有 `services::config` 的 get/set 命令（Rust 是单一真源）。
- “运行时命令类”（重置视角、切 toolMode、播放动作）走事件总线直达 AvatarWindow。

### 5.4 Panel ↔ Avatar 状态同步（P1，但建议尽早设计）

Panel 需要显示/控制 VRM 的运行时状态（当前动作、工具模式、是否在跳舞等），而 VRM 实例只存在于 AvatarWindow。建议二选一：

方案 A（快照请求/响应，侵入小）：

1. Panel 打开时，Rust 向 AvatarWindow emit：`"vrm-state-request"`.
2. AvatarWindow 收到后 `invoke("vrm_state_snapshot", snapshot)` 或 emit 回 Rust：`"vrm-state-snapshot"`.
3. Rust 将 snapshot 转发给 Panel（或直接由 Panel 订阅 `"vrm-state-snapshot"`）。

方案 B（Rust 侧做单一真源，更一致）：

- 所有“运行时状态变更”也经由 Rust 中转（Panel 与 Avatar 都订阅同一份状态），Panel 随时可从 Rust 读取最新快照。

V1 最小建议：先做方案 A（只在 Panel 打开时拉一次），避免 UI 显示“未知状态”。

---

## 6. 迭代计划（建议 v0.1 / v0.2 / v0.3 推进）

### v0.1（最小可跑通）

- 新增 AvatarWindow + `ContextPanelWindow`
- AvatarWindow 接入 cursor gate + mask 快照缓存
- 模型右键 → 打开胶囊（Panel）
- Panel 先只放 Chat（复用现有），VRM/Debug 先保留在 AvatarWindow 或只放少量开关

**DoD**

- 只有点在模型像素上才会阻挡底层窗口点击
- 右键模型稳定唤出胶囊，胶囊可正常输入/交互
- AvatarWindow 点击不抢焦点（`WM_MOUSEACTIVATE` 生效）
- mask 未就绪时仍有入口（托盘/启动期粗命中；不做快捷键）

### v0.2（交互更像桌宠）

- Tool 模式分流（不依赖快捷键）：
  - `Pet`（默认）：左键拖拽移动窗口（角色一起走）；滚轮缩放窗口
  - `Model`：左键拖拽移动模型（窗口不动）；滚轮缩放模型
- 动态提高 mask 刷新频率（跳舞/拖拽时 30Hz）
- 增加 Debug overlay：显示 rect 与 mask 命中点，便于调试

### v0.3（把 VRM/Debug 面板完整搬进胶囊）

- VRM/Debug 控制统一收口到胶囊 Tabs（`VrmTab/DebugTab`）；AvatarWindow 只保留渲染 + hit-test debug overlay（可开关）
- Panel 通过命令总线控制 Avatar 的运行时行为（播放动作/重置视角/切工具模式）

---

## 7. 代码组织建议（可选，但能显著降低返工）

Rust（`src-tauri/src/`）建议拆分：

```
windows/
  mod.rs
  avatar_window.rs     # HWND subclass + cursor gate + WM_MOUSEACTIVATE
  panel_window.rs      # 胶囊创建/定位/翻转/多显示器
  hittest_mask.rs      # MaskSnapshot + ArcSwap/seq 丢弃策略
commands/
  mod.rs
  avatar_commands.rs   # avatar_update_hittest_mask
  panel_commands.rs    # open_capsule / panel 控制命令
```

前端（`src/`）建议按窗口拆分：

```
windows/
  avatar/
    AvatarRoot.tsx
    MaskGenerator.ts   # GPU mask 生成 + bitset 打包（预留 async readback 接口）
    useHitTestMask.ts  # 定时/动态触发 mask 更新 + visibility pause
  panel/
    PanelRoot.tsx
    tabs/
      ChatTab.tsx
      VrmTab.tsx
      DebugTab.tsx
```

---

## 8. 测试策略（建议先写成 DoD 用例）

| 场景 | 验证点 |
|------|--------|
| 模型静止 | 点模型像素 → 事件到达 Three.js；点透明区域 → 透传到底层 |
| 模型跳舞 | 手臂挥动/大幅运动时仍可点；透明区域仍透传 |
| 窗口 resize | mask 重新生成；坐标映射无系统性偏移 |
| 高 DPI（150%/200%） | cursor gate 命中与视觉一致；不会“点空白挡点击/点模型没反应” |
| 多显示器（不同 DPI） | 角色跨屏移动/贴边时胶囊定位与翻转正确 |
| 快速点击/刚启动 | mask 尚未更新时不 panic，降级策略生效且仍有入口 |

---

## 9. 风险清单与对策

- `readPixels` GPU stall：优先低分辨率 + 10Hz，交互/跳舞时短暂提频；必要时做“变化检测”减少无效更新。
- 异步 readback：P1 优先推进 WebGL2 PBO 或 OffscreenCanvas/Worker，降低集显上 `readPixels` 抖动风险。
- WndProc Hook 与 Tauri/winit 冲突：优先 `SetWindowSubclass`；必要时对子窗口也挂；异常时降级为“全透明不可交互”而不是“整窗拦截”。
- 坐标/DPI 错位：把“WebGL drawingBuffer 像素”写成硬约束并在 IPC 上传 `viewportW/H` 做 sanity check；提供 Debug overlay 快速定位。
- 启动期无入口：坚持“缺数据就透明”时，必须有托盘/启动期粗命中兜底（本项目不做快捷键）。
