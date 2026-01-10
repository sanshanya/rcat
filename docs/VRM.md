# VRM Skin / VRM 皮肤（rcat）

rcat 支持一个 `skinMode=vrm` 的“VRM 皮肤”：**VRM 是舞台（全窗口透明层）**，Chat 与 Debug 是浮动 HUD。

> 目标：VRM 模式下以“角色/舞台”为核心；非 VRM 模式下以“聊天”为核心。

## 交互（当前实现）

- **平移**：在 VRM 画布上按住左键拖动（OrbitControls pan）。
- **缩放**：鼠标滚轮缩放（OrbitControls dolly）。
- **重置视角**：双击 VRM 画布，重新 fit 视角并写入持久化。
- **视角记忆**：按 VRM URL 存储相机位置 + target（Tauri 主存储为 `savedata/settings.json`，Web/兜底为 `localStorage`），下次加载恢复。

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
- `src/components/vrm/idleMotion.ts`
  - Idle motion JSON 解析/缓存与 procedural clip 构建（含 rest pose capture）。
- `src/components/vrm/armNormalization.ts`
  - VRM 加载时的手臂姿态归一化（避免“手背后/过度 T-pose”影响 idle 表现）。
- `src/components/vrm/ExpressionDriver.ts`
  - 表情通道别名解析 + bindings 检测（兼容不同 VRM 表情命名）。

### 状态与设置

- `src/components/vrm/vrmStore.ts`
  - 运行时 VRM 实例（`VRM | null`）+ `MotionController` 句柄。
- `src/components/vrm/renderFpsStore.ts`
  - 渲染帧率模式（`auto/30/60`），Tauri 主存储为 `savedata/settings.json`（保留 localStorage 兜底/迁移）。

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

### Web / 兜底（localStorage）

- `rcat.vrm.fpsMode`：渲染帧率模式
- `rcat.vrm.viewState:<encodedUrl>`：相机位置 + target

> 说明：Tauri 环境以 `savedata/settings.json` 为准；localStorage 仅用于 Web 预览/兜底与旧数据迁移。

## 已知 TODO（建议）

- 拆分 `useVrmBehavior.ts`：按 gaze / blink / idle motion / lip-sync / motion 播放拆成更小模块，降低维护成本。
- HUD 体验：让 Debug/Chat 面板可拖拽、吸附边缘、记忆位置，并提供“锁定/编辑布局”开关。
- 持久化补全：把 `skinMode`、HUD 布局（位置/尺寸/是否隐藏）纳入 `savedata/settings.json`，并提供一键重置。
