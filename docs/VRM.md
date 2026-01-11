# VRM Skin / VRM 皮肤（rcat）

rcat 支持一个 `skinMode=vrm` 的“VRM 皮肤”：**VRM 是舞台（全窗口透明层）**，Chat 与 Debug 是浮动 HUD。

> 目标：VRM 模式下以“角色/舞台”为核心；非 VRM 模式下以“聊天”为核心。

## 交互（当前实现）

- **平移**：在 VRM 画布上按住左键拖动（OrbitControls pan）。
- **缩放**：鼠标滚轮缩放（OrbitControls dolly）。
- **重置视角**：双击 VRM 画布，重新 fit 视角并写入持久化。
- **视角记忆**：按 VRM URL 存储相机位置 + target（Tauri 主存储为 `savedata/settings.json`，Web/兜底为 `localStorage`），下次加载恢复。
- **角色放置**：在 VRM Debug → Tool 切换到 `Avatar` 后，可拖动角色并滚轮缩放，按 VRM URL 持久化位置/缩放。
- **鼠标追踪（分层）**：Eyes / Head / Spine 三路叠加（权重/上限/平滑可调），在 VRM Debug → Mouse Tracking 调参。
  - 参考：`docs/MATE_ENGINE.md`（Mate-Engine 的实现思路与 rcat 映射）
  - 参考：`docs/LOBE_VIDOL.md`（Lobe Vidol 的 Viewer/交互/LookAt 平滑实现）
- **表情 / 情感（8 类情感）**：在 VRM Debug → Emotion 选择并调强度；支持按 VRM URL 绑定到模型的实际表情通道，并可选“情感 → 动作”映射（见 `docs/VRM_EXPRESSIONS.md`）。

## 代码结构（关键文件）

### UI / 入口

- `src/components/vrm/VrmStage.tsx`
  - VRM 皮肤入口：渲染全窗口 `VrmCanvas` + 悬浮 `VrmDebugPanel`。
- `src/components/vrm/VrmCanvas.tsx`
  - 负责 VRM 加载/卸载、错误展示、WebGL context restore 触发 reload。
  - 把 VRM 实例写入 `vrmStore`，供 Debug 面板/动作系统访问。

### 渲染器（Three.js）

- `src/components/vrm/useVrmRenderer.ts`
  - 创建 `WebGLRenderer` / `Scene` / `Camera` / Lights。
  - 使用 `GLTFLoader + VRMLoaderPlugin` 加载 VRM，并做资源清理（dispose）。
  - 通过 `OrbitControls` 提供平移/缩放交互；首次加载会 `fit` 视角。
  - 渲染循环支持 `RenderFpsMode`（auto/30/60）。

### 行为系统（动画/表情/口型/视线/动作）

- `src/components/vrm/useVrmBehavior.ts`
  - Idle motion（JSON/VRMA/FBX/VMD）、眨眼、注视目标、头部轻微摆动。
  - LipSync（Tauri 事件驱动）→ 表情通道（通常用 `aa`）。
  - MotionController：动作播放、VMD IK 后处理、平滑。
- `src/components/vrm/AvatarMouseTracking.ts`
  - 鼠标追踪的核心逻辑（头 / 脊椎 / 眼），采用 “driver + additive blending” 的思路（类似 Mate-Engine）。
- `src/components/vrm/idleMotion.ts`
  - Idle motion JSON 解析/缓存与 procedural clip 构建（含 rest pose capture）。
- `src/components/vrm/armNormalization.ts`
  - VRM 加载时的手臂姿态归一化（避免“手背后/过度 T-pose”影响 idle 表现）。
- `src/components/vrm/ExpressionDriver.ts`
  - 表情通道别名解析 + bindings 检测（兼容不同 VRM 表情命名）。
- `src/components/vrm/ExpressionMixer.ts`
  - 多通道表情混合器：`base/emotion`、`hover`、`blink`、`mouth` 等统一在一处合成，避免模块互相覆盖。
- `src/components/vrm/emotionRecipes.ts`
  - 8 类情感 → 表情权重 recipe（缺失时用组合兜底）。
- `src/components/vrm/emotionApi.ts`
  - 面向“外部调用（含 AI）”的最小接口：设置情感/强度、按标签解析情感。

### 状态与设置

- `src/components/vrm/vrmStore.ts`
  - 运行时 VRM 实例（`VRM | null`）+ `MotionController` 句柄。
- `src/components/vrm/renderFpsStore.ts`
  - 渲染帧率模式（`auto/30/60`），Tauri 主存储为 `savedata/settings.json`（保留 localStorage 兜底/迁移）。
- `src/components/vrm/mouseTrackingStore.ts`
  - 鼠标追踪参数（head/spine/eyes），Tauri 主存储为 `savedata/settings.json`（保留 localStorage 兜底/迁移）。
- `src/components/vrm/expressionBindingsStore.ts`
  - 表情槽位绑定（按 VRM URL）：把内部表情槽（happy/sad/...）映射到模型实际 expression name。
- `src/components/vrm/emotionStore.ts`
  - 当前情感状态（8 类 + 强度）。
- `src/components/vrm/emotionProfileStore.ts`
  - “情感 → 动作”映射（按 VRM URL），用于情感驱动可选动作播放。

## 资源与动作（public/vrm）

- VRM 模型：`public/vrm/*.vrm`
- Idle motion（JSON）：`public/vrm/idle.motion.json`
- 动作目录与索引：`public/vrm/motions/*` + `public/vrm/motions/index.json`
  - `MotionEntry` 支持 `fbx / vrma / vmd / glb / gltf`
  - 当前禁止 catalog 里的远程 URL（安全与可控性）

## 持久化（settings.json + localStorage fallback）

### Tauri（主存储）

- `savedata/settings.json` → `vrm.fpsMode`：渲染帧率模式
- `savedata/settings.json` → `vrm.viewStates[url]`：相机位置 + target（按 VRM URL）
- `savedata/settings.json` → `vrm.avatarStates[url]`：角色位置 + scale（按 VRM URL）
- `savedata/settings.json` → `vrm.expressionBindings[url]`：表情 bindings（按 VRM URL）
- `savedata/settings.json` → `vrm.emotionProfiles[url]`：情感 motion profile（按 VRM URL）
- `savedata/settings.json` → `vrm.mouseTracking`：鼠标追踪参数（head/spine/eyes）
- `savedata/settings.json` → `vrm.hudLayout`：VRM HUD 布局（锁定 + 面板位置）

### Web / 兜底（localStorage）

- `rcat.vrm.fpsMode`：渲染帧率模式
- `rcat.vrm.viewState:<encodedUrl>`：相机位置 + target
- `rcat.vrm.avatarState:<encodedUrl>`：角色位置 + scale
- `rcat.vrm.hudLayout`：VRM HUD 布局
- `rcat.vrm.expressionBindings:<encodedUrl>`：表情 bindings
- `rcat.vrm.emotionProfile:<encodedUrl>`：情感 motion profile

> 说明：Tauri 环境以 `savedata/settings.json` 为准；localStorage 仅用于 Web 预览/兜底与旧数据迁移。

## 已知 TODO（建议）

- 拆分 `useVrmBehavior.ts`：按 gaze / blink / idle motion / lip-sync / motion 播放拆成更小模块，降低维护成本。
- HUD 体验：让 Debug/Chat 面板可拖拽、吸附边缘、记忆位置，并提供“锁定/编辑布局”开关。
- 持久化补全：把 `skinMode`、HUD 布局（位置/尺寸/是否隐藏）纳入 `savedata/settings.json`，并提供一键重置。
- 追踪权限系统：按动作/状态禁用 spine/head/eyes，避免特定动画被扭坏（参考 Mate-Engine 的 Tracking Permissions）。
