# Code Review / 改进清单

## ✅ 已完成（本轮）

- 移除 `.env` / `.env.example`：AI 配置入口统一为应用内 Settings，并持久化到 `savedata/settings.json`
- Tailwind 语义化：更多使用 `bg-background` / `bg-muted` / `border-border` 等 token，并补全了 `secondary/accent/destructive/ring/input` 等颜色变量
- Tailwind 动画收敛：`collapsible-*` keyframes/animation 移到 `tailwind.config.js`
- History 基建：引入结构化错误 `HistoryError`，并新增分页接口 `history_get_conversation_page(beforeSeq, limit)`
- 文档补齐：新增 `docs/ARCHITECTURE.md`、`docs/settings.md`

## 🔴 建议尽快处理

- 行尾统一：保留 `.gitattributes`，并在本地执行一次 `git add --renormalize .`，避免 CRLF/LF 导致 diff 噪音
- 前端大组件继续拆：`src/components/views/SettingsView.tsx` 仍偏大，建议抽 `useSettingsForm` + 子组件（ProviderSelector/ModelChips/ApiKeyInput 等）
- Node 版本约束：Vite 需要 Node `>=20.19.0`，建议用 `.nvmrc` 或 CI 校验避免构建环境不一致

## 🟡 后续（可选）

- HistoryStore 热路径 prepared statements：缓存 `conn.prepare()`（消息同步、列表/分页查询）以减少解析/规划开销
- schema_version 迁移体系：引入 `schema_version` 表 + 增量迁移脚本，保证未来升级可控
- Usage 更准确：流式结束时从 provider 返回 usage 并发事件给前端（估算作为 fallback）
