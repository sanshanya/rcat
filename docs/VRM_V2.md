# VRM V2：目标 / 未完成项 / 推进建议

> V2 目标：在 V1（Windows-only demo）基础上，把“桌宠体验 + 可扩展互动”做成**长期可维护、可迭代**的结构，而不是继续靠补丁堆叠。

---

## 0) V1 已经完成了什么（作为 V2 的地基）

- **像素级穿透 + 可交互**：AvatarWindow 通过 hit-test mask + Rust cursor gate 做到“模型内可点，模型外穿透”。
- **两窗口分工**：AvatarWindow 仅渲染 VRM；Panel 负责 Chat/VRM/Debug UI。
- **无快捷键桌宠操作**：默认（Pet/Avatar mode）左键拖拽移动窗口、滚轮缩放窗口；Model mode 才操作模型；Camera mode 才启用 orbit controls。
- **输入兜底收口**：Windows `WH_MOUSE_LL` 统一处理 wheel 转发 + panel 点外隐藏；cursor gate 轮询也收口为单一 service。
- **互动系统打底**：已落地 Events → Reactions 的单入口（InteractionRuleEngine），具备 click/dragStart/dragEnd/pat 等事件与扩展出口（Expression/Motion/SFX/Bubble）。
- **观感增强**：说话状态有更平滑的 gate/衰减；拖拽有“整体晃动 + springbone 风”两层物理反馈。
- **TS “减山”已开始**：`useVrmBehavior` / `useVrmRenderer` 从“上帝 hook”拆为 controller/runtime 模块（便于 V2 继续扩展而不堆补丁）。

---

## 1) V1 现阶段仍未做 / 不够产品化的点

### 交互/互动

- Bubble/SFX 目前是“接口已打通”，但缺少**最终呈现与资源管理**（HUD 气泡样式、音效资源包、音量/并发/节流策略）。
- 互动规则仍以硬编码为主，尚未做到 **数据驱动**（每个 avatar/pack 一份 rules 配置）。
- 互动事件还缺：
  - 长按/抚摸的更细分（pressure/节奏/速度），以及“不同区域不同反馈”的可配置权重
  - 与动作系统联动的“打断/优先级/冷却”策略（例如拖拽必然打断跳舞）

### 动作/说话自然度

- “待机 ↔ 说话”切换仍偏硬：缺少统一的 **State Machine / Blend 策略**（idle loop / speech loop / gesture / emotion / motion 的叠加与权重控制）。
- “说话动作”目前偏微动，缺少可配置的 talk motion library（头/胸/手势）与节奏控制。

### 稳定性/验证

- 高 DPI（150%/200%）与多显示器（不同 DPI）的回归矩阵需要补齐（尤其是 mask 映射与 panel 定位）。
- Panel 点外隐藏偶发误判仍是高风险区：需要更可观测的日志与更明确的“inside 判定”策略（popups/resize border/overlap）。

---

## 1.1) 在做 V2 之前，建议先把 V1 再“减山”的清单

- TS：继续把 `useVrmRenderer/useVrmBehavior` 保持为“装配层”，把复杂度压到 `*Controller/*Runtime`（已完成第一刀）。
- TS：把“说话 ↔ 待机”的混合策略从零散 if-else 收口为一个 BehaviorFSM（先做 `idle ↔ speech` 两态即可）。
- Rust：继续把 Win32 glue 维持单 owner（`AvatarWindowsService`），避免新增第二套 hook/ticker（只在 service 内扩展）。

---

## 2) VRM V2 的目标（按优先级）

### V2.0（核心体验 + 可扩展性）

1. **互动系统数据化**：
   - 定义 `InteractionPack`（zones + rules + assets）格式
   - 默认规则从 TS 硬编码迁移到 JSON/TS 配置（支持热更新/未来 Mods）
2. **统一的行为状态机（Behavior FSM）**：
   - 收口 idle/speech/motion/drag/hover 等状态与优先级
   - 明确“可打断”与“不可打断”的动作类别（并暴露接口给互动规则引擎）
3. **Bubble/SFX 落地**：
   - AvatarWindow HUD 提供气泡渲染
   - SFX bus 提供资源加载、并发限制、节流与音量管理

### V2.1（观感与沉浸）

- 更自然的 look-at：平滑 + saccade（扫视）+ 目标优先级（global cursor / panel focus / drift）
- 拖拽物理参数可配置化：整体晃动 + springbone wind 的力度、attack/release、与 motion 播放的混合策略
- “触摸反馈”动作库：pat/摸头/戳脸等小动作（与 Expression/SFX/Bubble 联动）

### V2.2（Windows 深度集成 / Mate-Engine 对齐）

- Surface/WindowSit/TaskbarSit：窗口探测、遮挡 occluder、吸附与 sitting 动作（需要 Rust/Win32 侧大工程）
- 更完善的资源包/ModLoader：音效/语音/动作覆盖与版本管理

---

## 3) 架构建议（避免再堆“补丁山”）

### 前端（TS）

- **单入口**：所有输入与状态变化都进入 `AvatarInteractionEngine`（Events → Reactions），由 rule engine 决定调用 Expression/Motion/SFX/Bubble。
- **状态机优先**：把“说话/待机/互动/动作播放”的混合策略从散落 if-else 收敛到一个 BehaviorFSM（可以先纯 TS 实现）。
- **接口留足**：rule engine 输出不要直接操作 Three 对象，优先调用“领域接口”（MotionController / ExpressionMixer / SfxBus / BubbleStore）。

### 后端（Rust/Win32）

- **单 owner service**：`AvatarWindowsService` 继续作为 hook + cursor gate 的唯一 owner（显式 start/stop、统一日志、统一节流）。
- **明确降级策略**：任何不确定状态一律 fail-open 到 click-through，避免“整窗挡鼠标”。

---

## 4) 下一步建议（明天开始推进的最小切片）

1. 先把 Bubble HUD 做出来（哪怕最简），让 Events → Reactions 的链路可视化（更容易调互动规则）。
2. 定义一份最小 `InteractionPack` 配置（zones + 3 条 rules：click/pat/drag），把默认规则迁移到配置文件。
3. 把“说话/待机切换”收口为 BehaviorFSM：先只处理 `idle ↔ speech` 的权重 blend，再逐步接入 motion/drag。
