# Code Review / 改进清单

## ✅ 已完成（本轮）

- 移除 `.env` / `.env.example`：AI 配置入口统一为应用内 Settings，并持久化到 `savedata/settings.json`
- Tailwind 语义化：更多使用 `bg-background` / `bg-muted` / `border-border` 等 token，并补全了 `secondary/accent/destructive/ring/input` 等颜色变量
- Tailwind 动画收敛：`collapsible-*` keyframes/animation 移到 `tailwind.config.js`
- History 基建：引入结构化错误 `HistoryError`，并新增分页接口 `history_get_conversation_page(beforeSeq, limit)`
- 文档补齐：新增 `docs/ARCHITECTURE.md`、`docs/settings.md`
- 文档补齐：新增 `docs/VRM.md`（VRM skin、交互、持久化与 TODO）
- VRM 偏好持久化：`vrm.fpsMode` / `vrm.viewStates` 写入 `savedata/settings.json`（保留 localStorage 兜底）
- VRM 鼠标追踪（分层）：Eyes / Head / Spine 三路叠加（权重/上限/平滑可调）并持久化到 `vrm.mouseTracking`
- VRM Debug：增加 Mouse Tracking 调参与 Reset，一次拖动产生的持久化写入做了 debounce（避免频繁写 settings.json）

## 🔴 建议尽快处理

- 行尾统一：保留 `.gitattributes`，并在本地执行一次 `git add --renormalize .`，避免 CRLF/LF 导致 diff 噪音
- 前端大组件继续拆：`src/components/views/SettingsView.tsx` 仍偏大，建议抽 `useSettingsForm` + 子组件（ProviderSelector/ModelChips/ApiKeyInput 等）
- Node 版本约束：Vite 需要 Node `>=20.19.0`，建议用 `.nvmrc` 或 CI 校验避免构建环境不一致
- VRM 行为系统拆分：`src/components/vrm/useVrmBehavior.ts` 已承载 idle/gaze/blink/lipsync/motion，建议拆成更小模块降低维护成本
- 追踪权限系统：按动作/状态禁用 spine/head/eyes，避免特定动作被扭坏（参考 `docs/MATE_ENGINE.md`）

## 🟡 后续（可选）

- HistoryStore 热路径 prepared statements：缓存 `conn.prepare()`（消息同步、列表/分页查询）以减少解析/规划开销
- schema_version 迁移体系：引入 `schema_version` 表 + 增量迁移脚本，保证未来升级可控
- Usage 更准确：流式结束时从 provider 返回 usage 并发事件给前端（估算作为 fallback）
- VRM HUD 体验：Debug/Chat 面板可拖拽、吸附、记忆位置，并提供“锁定/编辑布局”开关
