![1768038779856](image/todo/1768038779856.png)![1768041554787](image/todo/1768041554787.png)![1768041557493](image/todo/1768041557493.png)**未完成（待评审）**

> 参考实现/思路：
>
> - `docs/MATE_ENGINE.md`：Mate-Engine（Unity）“头/脊椎/眼”分层追踪 + 权限系统
> - `docs/LOBE_VIDOL.md`：Lobe Vidol（Web）Viewer/交互/LookAt 平滑 + saccade + 触摸体系

## P0（近期：Demo 风险项 / 影响观感）

- 追踪权限系统（Tracking Permissions）
  - 按 “动作/状态/是否说话/是否交互” 决定 head/spine/eyes 是否启用，避免某些动作被扭坏
  - 实现方式建议：在 MotionEntry 或 runtime state 上提供 allowHead/allowSpine/allowEyes，传给追踪更新入口（类 Mate-Engine 的 state/parameter gating）
- 鼠标追踪坐标模型升级（更自然）
  - 从 “归一化(-1..1) 直接映射 yaw/pitch” 升级为 “屏幕点 → camera 射线/世界方向 → bone parent localDir → yaw/pitch”
  - 目标：不同窗口尺寸/比例下观感一致，且不会出现“鼠标在下却抬头/偏航错位”的系统性问题
- HUD 布局系统（可拖拽/可记忆）
  - Debug/Chat 面板可拖拽、吸附、记忆位置；提供 “锁定/编辑布局” 开关
  - 持久化：写入 `savedata/settings.json`（HUD layout），避免写死导致 UI 不合适
- Avatar 放置模式（以 VRM 为核心）
  - 在 VRM 模式下，允许在窗口内 **拖动放置角色位置**、**缩放角色**（不再被“固定窗口框”束缚）
  - 与相机 OrbitControls 分离：提供 “编辑角色/编辑相机” 两种模式，避免交互冲突
  - 持久化：按 VRM URL 或 skin 记忆位置/缩放
- VRM Debug：增加 VMD 相关开关（快速定位抖动来源）
  - IK on/off（禁用 IK 用于对照是否 IK 导致抖动/瞬移感）
  - includeFingers on/off（手指轨道开关，用于近景/特写质量 vs 低占用）
  - smoothingTau 可调（例如 0.06～0.20，便于不同模型/动作调参）
- VRM Debug：展示渲染性能指标（辅助 Auto 60/30 判断）
  - rafEmaMs / workEmaMs（可直接读 renderFpsStore）
- VMD 质量：为 VMD 动作提供“性能档位”预设（默认低占用）
  - 低：includeFingers=false + IK=on + smoothingTau=0.12（现状）
  - 高：includeFingers=true + IK=on + smoothingTau=0.08（近景用）

## P1（下一阶段：体验提升 / 桌宠感）

- LookAt 平滑路线（优先 VRM1.0 兼容）
  - 尝试优先走 `vrm.lookAt`：userTarget + smoothing + saccade（参考 Lobe Vidol 的 `VRMLookAtSmoother`）
  - 与分层追踪共存策略：Eye 走 lookAt，Head/Spine 仍走 additive（或由 lookAt/head assist 统一）
- 触摸交互（raycaster + bone map）
  - 点击/触摸命中模型 → 最近骨骼 → TouchArea（头/胸/腹/四肢）
  - TouchArea 触发：表情 + 动作 + 台词（可配置），并具备状态门控（speaking/dancing 时禁用）
- VRM 工具栏（比 Debug 更像产品）
  - 截图、全屏、网格、重置视角、交互开关、重置到 idle
- 资源导入提效（开发/演示）
  - VRM/VRMA/FBX/VMD/舞台资源的 drag&drop 导入（参考 Lobe Vidol）
- 背景/舞台系统
  - 背景图层与 Canvas 解耦（透明舞台），支持背景图片/简单 stage，并持久化配置

## P2（中长期：架构与可维护性）

- Skin/Mode 体系（你提出的“VRM 核心 vs Chat 核心”）
  - VRM 状态：以 VRM 舞台为核心（HUD 浮动、可布局）
  - 非 VRM 状态：以 chat 为核心（窗口自适配）
  - 目标：避免布局/交互写死，减少后续扩展成本
- 行为系统模块化
  - 拆分 `useVrmBehavior`：gaze/blink/lipsync/idle/motion/tracking 分模块组合
  - 目标：降低耦合，便于加权限系统、可视化 debug、单元测试

## 评审建议（验收标准）

- 追踪观感：无明显“反向/偏航”，可调参、切动作不突变（fade 生效）
- 交互一致：编辑角色/编辑相机模式互不抢输入；HUD 可拖拽且记忆位置
- 稳定性：长时间运行无明显内存/句柄泄漏；settings 写入频率可控
- 可扩展：模式切换（VRM/Chat）边界清晰，后续可加触摸/舞台/工具栏而不推倒重来
