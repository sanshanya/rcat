# Mate-Engine 参考（用于 VRM 鼠标追踪）

这份文档用于后来者**快速浏览**本地参考工程 `example/Mate-Engine-main`（Unity 桌宠项目），并把其中的核心设计映射到 rcat 的实现上，方便持续迭代“头 / 脊椎 / 眼”三路鼠标追踪。

> 本地路径示例：`F:\\github\\rcat\\example\\Mate-Engine-main`  
> 仓库内相对路径：`example/Mate-Engine-main`（建议保持 **git ignore**，避免把 Unity 工程提交进来）

## 读代码只看这一个文件就够（先把它读透）

- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/AvatarMouseTracking.cs`

阅读顺序（建议照着看，不要跳）：

1. `Start()`：初始化 Animator / Camera / VRM10 instance，随后 `InitHead()` / `InitSpine()` / `InitEye()`
2. `LateUpdate()`：每帧入口（关键点：**在 Animator 之后做追踪**，避免“动画和追踪抢骨骼”）
3. `IsAllowed()`：追踪权限系统（按 Animator state / bool parameter 决定 head/spine/eye 是否启用）
4. `DoHead()` / `DoSpine()` / `DoEye()`：三路追踪的核心逻辑（driver + 平滑 + 限制 + additive 混合）

## Mate-Engine 的核心设计（要抄就抄这几个点）

### 1) LateUpdate：追踪发生在动画之后

- Unity 里用 `LateUpdate()`，确保 Animator 已经写入骨骼姿态；追踪是“附加层”。
- 对应到 rcat：应确保 mouse tracking 的计算发生在 idle/motion 动画更新之后，并且在渲染前。

### 2) Driver Transform：先算目标，再用 delta 叠加到 base pose

Mate-Engine 的混合写法（核心思想）：

- `driver.localRotation`：追踪目标旋转（带 smooth）
- `delta = driver.localRotation * inverse(initRot)`
- `bone.localRotation = slerp(baseRot, delta * baseRot, blend)`

这意味着：

- **baseRot** 仍来自 Animator（更自然）
- **delta** 是“追踪增量”
- **blend** 是“跟随强度 vs 动画观感”的核心旋钮

### 3) Spine 分层衰减 + Fade

- `spineTrackingWeight` 用 `MoveTowards` 淡入淡出（权限/状态切换时不会突变）
- 同一个 delta 影响 `spine -> chest -> upperChest`，逐级衰减（更自然）

### 4) VRM 1.0 优先用 LookAt（否则回落到眼骨）

- `vrm10.LookAtTargetType = YawPitchValue`：VRM1.0 用内置 LookAt 系统更兼容约束
- 没有 VRM10 时才直接旋转 LeftEye/RightEye bones

### 5) Tracking Permissions System（避免“某些动作被扭坏”）

- `trackingPermissions` 既支持按 **state**（含过渡 next state）也支持按 **bool parameter**
- 这是“可调但不打架”的重要保障：有些动作必须关 spine/head/eye，否则会破坏动作意图

## 参数映射（Mate-Engine → rcat）

Mate-Engine（C#）| rcat（TS）
---|---
`enableMouseTracking` | `vrm.mouseTracking.enabled`
`headYawLimit/headPitchLimit` | `vrm.mouseTracking.head.yawLimitDeg/pitchLimitDeg`
`headSmoothness` | `vrm.mouseTracking.head.smoothness`
`headBlend` | `vrm.mouseTracking.head.blend`
`spineMinRotation/spineMaxRotation` | `vrm.mouseTracking.spine.minYawDeg/maxYawDeg`
`spineSmoothness` | `vrm.mouseTracking.spine.smoothness`
`spineFadeSpeed` | `vrm.mouseTracking.spine.fadeSpeed`
`spineBlend` | `vrm.mouseTracking.spine.blend`
`eyeYawLimit/eyePitchLimit` | `vrm.mouseTracking.eyes.yawLimitDeg/pitchLimitDeg`
`eyeSmoothness` | `vrm.mouseTracking.eyes.smoothness`
`eyeBlend` | `vrm.mouseTracking.eyes.blend`
`trackingPermissions` | （TODO）rcat 暂无等价系统

rcat 相关文件：

- 追踪核心：`src/components/vrm/AvatarMouseTracking.ts`
- 行为入口：`src/components/vrm/useVrmBehavior.ts`
- 调参面板：`src/components/vrm/VrmDebugPanel.tsx`
- 持久化：`src-tauri/src/services/config.rs`（`settings.vrm.mouseTracking`）

## 基于 Mate-Engine 的改进建议（rcat TODO）

- 追踪权限系统：参考 `trackingPermissions` 的思路，按 motion/idle clip 或“行为状态”禁用 head/spine/eyes。
- 3D 方向计算：Mate-Engine 是“屏幕点 → 世界点 → bone localDir → yaw/pitch”；rcat 当前是标准化 gaze 值（-1..1），后续可升级为基于 three.js camera 的射线方向计算以更贴近真实观感。
- VRM LookAt 优先：对 VRM1.0 尝试走 `vrm.lookAt` 的 yaw/pitch 通路（而不是直接旋眼骨），兼容 VRM LookAt 约束。

