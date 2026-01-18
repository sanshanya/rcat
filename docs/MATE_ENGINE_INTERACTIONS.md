# Mate-Engine 参考（互动 / 动作 / 可扩展接口）

这份文档用于把本地 Unity 参考工程 `example/Mate-Engine-main` 里的**桌宠互动/动作**抽象出来，并映射到 rcat（Tauri + WebView2 + Three.js + VRM）的可扩展实现上。

> 目标不是“移植 Unity 实现”，而是复用其**事件 → 反应（Reaction）**的结构，让 rcat 后续做点击互动/动作/音效/气泡文本时不会推倒重来。

---

## 1) Mate-Engine 的核心互动模块（建议先读这些文件）

### 触摸/悬停区域（Touch Regions / Hover Reactions）

- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/PetVoiceReactionHandler.cs`
  - 以 `VoiceRegion` 列表描述“区域”：绑定骨骼 + 半径 + offset
  - 每帧把 bone world pos 投影到屏幕坐标，做“鼠标在圈内”判定
  - 触发内容：
    - Animator：bool 参数或 CrossFade 到指定 state/layer
    - Audio：随机语音/叠加语音
    - Hover Object：可选的粒子/物体生成并跟随骨骼
  - 额外：`Pat Mode`（绕圈/抖动手势）作为更强的触发条件

### 拖拽状态 / 拖拽音效

- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/AvatarAnimatorController.cs`
  - `isDragging/isIdle/isDancing` 等状态机；拖拽会打断跳舞
- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/AvatarDragSoundHandler.cs`
  - 监听 `isDragging` 的边沿变化，播放 start/stop 音效（可随机 pitch）

### “事件驱动消息”（气泡）

- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/AvatarRandomMessages.cs`
  - 随机 & “进入某个 Animator state 时”展示文本气泡
  - 带 stream 逐字效果 & `isTalking` Animator 参数

### 窗口坐/任务栏坐（Surface / Occluder）

- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/AvatarWindowHandler.cs`
  - Win32 枚举窗口，探测可坐目标，吸附 + 遮挡（用 quad occluder）
- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/AvatarHandlers/AvatarTaskbarController.cs`
  - 任务栏矩形探测 + sitting 动画 + 可选 attach 道具

### Mod 结构（数据驱动）

- `example/Mate-Engine-main/Assets/MATE ENGINE - Scripts/Settings/MEModLoader.cs`
  - 约定目录结构，把音效覆盖注入到 Drag/Chibi/Hover Reactions
- `example/Mate-Engine-main/Assets/Editor/MEModInitializer.cs`
  - Editor 下预创建 `StreamingAssets/Mods/ModLoader/...` 目录

---

## 2) rcat 侧：已经具备的“事件 → 反应”能力

rcat 目前已有的基础设施（可复用来做互动/动作）：

- **输入/穿透**：像素级 mask + Rust cursor gate（模型外穿透、模型内可交互）
- **动作**：`MotionController`（VRMA/Mixamo）+ idle clip
- **表情**：`ExpressionMixer`（多 channel 混合，适合把“hover/click/情绪/说话”等拆成独立层）
- **全局指针**：Rust `global-cursor-gaze`（即使 click-through 也持续更新）

这次补上的关键接口（为互动系统打地基）：

- `src/components/vrm/avatarHitTestMaskRuntime.ts`
  - JS 侧缓存最新 mask bitset，并提供 `hitTestAvatarMaskAtNdc()` 用于“是否真的在角色像素上”
- `src/components/vrm/avatarInteractionController.ts`
  - 统一产出 `AvatarInteractionEvent`（zoneEnter/zoneLeave/click/dragStart/dragEnd/pat）与 hover 表情帧
  - 输入来自 `src/components/vrm/avatarInteractionInputRuntime.ts`（canvas pointer events 的轻量队列）
- `src/components/vrm/avatarInteractionRuleEngine.ts`
  - Events → Reactions 单入口：把事件映射为 Expression/Motion/SFX/Bubble（V1 先落地 Expression + 接口打底）

---

## 3) 推荐的可扩展架构（对齐 Mate-Engine）

建议把互动做成 3 层，尽量数据驱动：

1. **Sensors（传感）**：输入/状态采集
   - pointer（来自 `global-cursor-gaze`）
   - 是否在 mask 像素内（`hitTestAvatarMaskAtNdc`）
   - 当前工具模式/是否在播放动作/是否在说话/Panel 是否可见

2. **Events（事件）**：把连续信号离散化
   - `zoneEnter/zoneLeave`
   - `click` / `longPress` / `pat` / `dragStart/dragEnd`
   - `motionStart/motionStop` / `speechStart/speechEnd`

3. **Reactions（反应）**：把事件映射为动作
   - Expression：写入 `ExpressionMixer` 某个 channel
   - Motion：调用 `MotionController.play(...)`
   - SFX：播放音效（后续可做本地资源包/Mod）
   - Bubble：在 AvatarWindow HUD 显示文本气泡（与 Mate-Engine 对齐）

数据驱动建议（对齐 Mate-Engine 的 Mods/ModLoader 思路）：

- 每个 avatar / pack 一份 JSON：声明 `zones` 与 `rules`（event -> actions）
- 资源（voice/sfx/particles）按目录约定加载，允许覆盖默认

---

## 4) 下一步（落地顺序建议）

1. ✅ 在 `AvatarInteractionController` 基础上补齐事件：
   - click / dragStart/dragEnd / pat（Pat 先用“按住 + 移动距离阈值”版本）
2. ✅ 增加 `InteractionRuleEngine`（纯 TS）：
   - 输入：事件 + 上下文
   - 输出：对 `ExpressionMixer/MotionController/Sfx/Bubble` 的调用
3. 下一步：把 rules 数据化（`mods/interactions/` + JSON schema），并把默认规则从硬编码迁移到 JSON
4. P2：再做 “Surface/WindowSit/TaskbarSit”（需要 Rust/Win32 支持，工程量较大）
