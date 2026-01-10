# Lobe Vidol 参考（用于 VRM 舞台 / 交互 / 动作体系）

这份文档用于后来者**快速浏览**本地参考工程 `example/lobe-vidol-main`（LobeHub 的 Web 虚拟偶像项目），并提取其中对 rcat 有价值的设计与实现思路。

> 本地路径示例：`F:\\github\\rcat\\example\\lobe-vidol-main`  
> 仓库内相对路径：`example/lobe-vidol-main`（建议保持 **git ignore**，避免把整套 Next.js 工程提交进来）

## 快速定位：与 rcat 最相关的文件（先看这些）

### 1) VRM Viewer（渲染循环 + 场景控制 + 交互入口）

- `example/lobe-vidol-main/src/libs/vrmViewer/viewer.ts`

重点方法：

- `setup(canvas, onBodyTouch)`：创建 `WebGLRenderer(alpha=true)`、`PerspectiveCamera`、`OrbitControls`、`Audio`，绑定 `ResizeObserver` 与点击事件。
- `loadVrm(url)`：卸载旧模型 → 创建 `Model` → `Model.loadVRM` → 加入 scene → load idle → `resetCamera()`。
- `update()`：内部 `requestAnimationFrame` 循环，驱动 `model.update(delta)`，渲染 scene。
- `handleClick()`：raycaster 命中模型 → 转换为 `TouchAreaEnum` → 回调给 UI（触摸交互）。
- 舞蹈/舞台：
  - `dance(vmdUrl, audioUrl, cameraUrl?)`：音频作为结束标志，播放 VMD + 可选 camera VMD，并自动进入全屏。
  - `loadStage(pmxUrl)`：加载 PMX 舞台（MMD 场景）。

### 2) Model（VRM 加载 + 表情/动作/口型 + 触摸识别）

- `example/lobe-vidol-main/src/libs/vrmViewer/model.ts`

关键点：

- 用 `VRMLoaderPlugin` 加载 VRM，并启用自定义 `VRMLookAtSmootherLoaderPlugin`（见下）。
- 初始化 `EmoteController(vrm, camera)`：把表情、动作、视线等“行为”收敛到一个控制器体系里。
- 触摸交互：创建头部 hitbox + raycaster + “最近骨骼”映射为 `TouchAreaEnum`（头/胸/腹/四肢等）。

### 3) LookAt 平滑器（更“像生命体”的眼动/头动）

- `example/lobe-vidol-main/src/libs/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmoother.ts`
- `example/lobe-vidol-main/src/libs/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmootherLoaderPlugin.ts`

它把 `VRMLookAt` 升级为：

- `userTarget`：用户目标与动画 target 分离（动画仍可控制 target）。
- 平滑（指数阻尼）+ 头部参与 + saccade（扫视微动）。
- `revertFirstPersonBoneQuat()`：渲染后把“临时转头”恢复，避免污染骨骼基姿态（实现细节值得抄）。

### 4) UI/模式切换的组织方式（对“皮肤/模式”很有参考价值）

- `example/lobe-vidol-main/src/store/global/index.ts`：全局 store 持有一个单例 `viewer`，并维护 `chatMode`（`'chat' | 'camera' | 'call'`）。
- `example/lobe-vidol-main/src/features/AgentViewer/index.tsx`：把 Viewer 包装成组件，负责资源预加载、拖拽导入（VRM/FBX/VMD/VRMA/PMX）、触摸回调。
- `example/lobe-vidol-main/src/features/AgentViewer/ToolBar/index.tsx`：成熟的“浮动工具栏”思路（截图/全屏/网格/重置/交互开关等）。
- `example/lobe-vidol-main/src/features/AgentViewer/Background/index.tsx`：背景是独立 DOM 层（图片或 glow），和 canvas 解耦。

## 关键设计总结（rcat 值得借鉴的点）

- **Viewer 作为“渲染服务”**：UI 只负责装配与调用（setup/load/unload），渲染循环在 Viewer 内聚合（便于做截图/全屏/舞蹈模式）。
- **行为分层**：`Model -> EmoteController -> ExpressionController/MotionController`，把“说话/表情/动作/视线/眨眼”等职责拆开（维护成本更低）。
- **生命感细节**：LookAt 平滑 + 头动混合 + saccade（比纯粹追鼠标更自然）。
- **触摸交互**：raycaster + hitbox + 最近骨骼映射，是桌宠最直观的互动方式之一。
- **模式门控**：`speaking` / `_isDancing` / `interactive` 等状态会直接影响交互与事件处理（避免逻辑互相打架）。

## 对照到 rcat（我们代码里对应在哪里）

Lobe Vidol | rcat
---|---
`Viewer.setup/loadVrm/update` | `src/components/vrm/useVrmRenderer.ts` + `src/components/vrm/VrmCanvas.tsx`
`Model.update`（含 lipSync/motion） | `src/components/vrm/useVrmBehavior.ts` + `src/components/vrm/motion/MotionController.ts`
LookAt smoother + saccade | （TODO）目前 rcat 采用 `src/components/vrm/AvatarMouseTracking.ts` 直驱骨骼
触摸交互（raycaster + bone map） | （TODO）rcat 暂无触摸系统
工具栏（截图/全屏/网格/交互开关） | （TODO）rcat 目前只有 `VrmDebugPanel`
`chatMode`（chat/camera/call） | `skinMode`（off/vrm）+（TODO）更细粒度的模式/布局

## 基于 Lobe Vidol 的改进建议（rcat TODO）

- 视线系统升级：在 VRM1.0 条件允许时，优先走 `vrm.lookAt` 的“userTarget + smoothing + saccade”路线（减少直接抢眼骨）。
- 触摸交互：给 VRM 加 raycaster 命中 → 最近骨骼 → 触发表情/动作/台词（桌宠体验提升非常大）。
- 工具栏/HUD：引入“浮动工具栏 + 可拖拽/记忆位置”，提供截图、全屏、网格、重置视角、交互开关。
- 资源导入：在 VRM 画布支持 drag&drop（VRM/VRMA/FBX/VMD），加快调试迭代。
- 舞台/背景：背景图层与 Canvas 解耦（透明舞台 + 背景可替换），并把配置纳入 `savedata/settings.json`。

