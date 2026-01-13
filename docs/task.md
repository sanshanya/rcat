# VRM Avatar Architecture

## P0 - MVP (Core Experience)
- [ ] **AvatarWindow MVP**
    - [ ] VRM 渲染 (透明/无边框/置顶)
    - [ ] 窗口不可穿透（尽量贴合角色大小，减少遮挡桌面）
    - [ ] 左键拖拽移动（窗口随之移动）
    - [ ] 左键按住 + 滚轮缩放（窗口大小同步缩放）
    - [ ] 右键触发 `openContext`
- [ ] **ContextPanelWindow MVP**
    - [ ] ChatPanel (输入框 + 最近 N 条消息 + 流式输出)
    - [ ] 复用现有 `ChatProvider` 数据流
    - [ ] `Focused(false)` 自动隐藏（未 pin 时）
    - [ ] P0 建议懒创建（避免 classic 模式重复 hooks）
- [ ] **锚定定位**
    - [ ] 角色边界矩形计算
    - [ ] Clamp 到当前显示器 work area
    - [ ] 角色拖动时面板跟随 + 必要时自动翻转
- [ ] **WindowManager 状态机**
    - [ ] `skin`: vrm | classic
    - [ ] `contextPanel`: open | closed | pinned
    - [ ] VRM 窗口尺寸持久化（不能污染 classic input/result 的持久化尺寸）
    - [ ] classic 模式保持现有 Mini/Input/Result 不回归

## P1 - Enhanced Experience
- [ ] **DebugPanel**
    - [ ] 日志 ring buffer
    - [ ] 关键延迟指标 (VAD/STT/LLM/TTS)
    - [ ] 最近 screenshot/OCR/tool-call 摘要
- [ ] **Pin 机制**
    - [ ] 钉住/取消钉住
    - [ ] 未 pin 时 click-outside close

## P2 - Polish
- [ ] **更细交互**
    - [ ] 左键单击/双击语义
    - [ ] QuickMenu
    - [ ] 跟随策略优化
    - [ ] 自动避让任务栏/边缘
