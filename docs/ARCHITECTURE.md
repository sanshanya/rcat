# Architecture / 架构（rcat）

rcat 是一个 Windows 优先的 **Tauri v2** 桌面应用：前端是 **React + Vite**，后端是 **Rust**。本文件关注：

- 代码边界（什么放哪）
- 核心链路（聊天流、历史、设置、窗口）
- 关键约束（不能破坏的 invariants）

## 1) 目录边界（放置规则）

### Backend（Rust，`src-tauri/`）

- `src-tauri/src/services/*`：Tauri command 暴露层（IPC boundary）。
- `src-tauri/src/plugins/*`：按功能拆分的内部模块（history、vision…）。
- `src-tauri/src/services/ai/*`：AI 流式/工具/abort 等基础设施。
- `src-tauri/src/services/config.rs`：Settings 持久化与默认值策略。

### Frontend（React，`src/`）

- `src/services/*`：对 `invoke` 的 typed wrapper 与自定义 transport。
- `src/hooks/*`：状态与副作用编排（尽量让 `App.tsx` 只做装配）。
- `src/contexts/*`：共享 UI 状态（例如 `ChatUiContext`）。
- `src/components/*`：展示组件 + 少量局部交互。
- `src/styles/index.css`：全局样式（Tailwind v4 theme + 少量 global CSS）。

## 2) Settings（运行时配置）

- 单一事实来源：`savedata/settings.json`（位于 app 可执行文件旁）。
- Provider profiles：每个 provider 维护 `baseUrl/apiKey/选中 model/model 列表`。
- 环境变量只用于“机器级”配置（不进入 UI）：
  - Turso/libSQL：`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`（或 `LIBSQL_*`）
  - VLM 图片压缩：`VLM_IMAGE_MAX_DIM`、`VLM_JPEG_QUALITY`

详见 `docs/settings.md`。

## 3) History（对话历史）与数据模型

### 存储后端

- 优先使用远端 Turso/libSQL（如果 env 配置齐全），否则 fallback 到本地 `savedata/history.db`。
- 本地 DB 下写入会串行化以降低 SQLITE_BUSY（`write_gate`）。

### 核心表（简述）

- `conversations`：对话元信息（title、last_seen、archived、title_auto）。
- `messages`：消息（conversation_id、seq、role、content、reasoning）。
- `app_state`：`active_conversation_id` 等状态。

### 不变式（重要）

- `messages.id` 格式：`${conversation_id}:${seq}`。
- `seq` 为 1-based，并约定只做“尾部截断 + 继续追加”，因此多数路径下 `MAX(seq)` 可作为 message 数的廉价 proxy。
- 标题优先级：`title_auto`：
  - `0`：占位/首条 user prompt（仍允许后续自动标题）
  - `1`：AI 自动标题
  - `2`：用户手动重命名（最高优先级，自动标题绝不能覆盖）
- 结构化错误：History API 返回 `HistoryError`（NotFound/Archived/Locked/...），便于前端做提示/重试。

## 4) Chat streaming（UI ⇄ Rust）

### 前端入口

- `src/App.tsx` 使用 `@ai-sdk/react` 的 `useChat()`。
- transport：`src/services/tauriChatTransport.ts` 将 `UIMessage[]` 转成后端 `ChatMessage[]`（seq/role/content）。
  - 当存在 `conversationId` 时，会携带 `truncateAfterSeq` 用于“从某个点重新生成/编辑后截断历史”。
  - 为避免历史未加载完成时误触发截断，UI 在 active conversation 未对齐前禁用发送（见 `src/App.tsx`）。

### 后端入口

- Tauri commands：`chat_stream` / `chat_stream_with_tools`（`src-tauri/src/services/ai/commands.rs`）
- 统一执行器：`start_stream_task`：
  - registry 去重（同 requestId / 同 conversationId 只允许一个任务）
  - sync：`HistoryStore.sync_from_frontend_messages()`（可选截断 + 批量 upsert）
  - 真正的 stream：`run_chat_stream` 或 `run_chat_with_tools`
  - 结束：写入最终 assistant 消息到 history，并 emit `chat-stream(done)` + `chat-done`

### 事件协议

- `chat-stream`：增量 chunk（包含 `kind: text | reasoning`）
- `chat-error`：流式错误
- `chat-done`：请求完成（前端用于 refresh history / 通知）

## 5) 分页加载（History）

- 前端初次加载与“向上加载更多”均走：
  - `history_get_conversation_page(conversationId, beforeSeq, limit)`
- 后端按 `seq` 倒序取一页再 reverse，保证返回的 `messages` 为升序。

## 6) Window modes / UI 形态

- 三种 WindowMode：
  - `mini`：胶囊 Capsule
  - `input`：输入模式
  - `result`：结果/完整对话模式
- 主要编排在 hooks：
  - `useToggleExpand`：mini ↔ input/result 切换策略
  - `useRouteController`：settings 路由控制
  - `useAutoWindowFit`：窗口适配

## 7) 类型生成（Rust → TS）

- Rust 侧类型通过 `specta` 派生（feature `typegen`）。
- 生成脚本输出到 `src/bindings/tauri-types.ts`（见 `docs/TYPEGEN.md`）。

## 8) 新功能落地 checklist（推荐）

1. 在 `src-tauri/src/plugins/<feature>/` 实现核心逻辑（内部 API 清晰、可复用）。
2. 通过 `src-tauri/src/services/<feature>.rs` 暴露最小 IPC surface。
3. 前端在 `src/services/<feature>.ts` 建立 typed wrapper（invoke 参数与返回值固定）。
4. 状态/副作用放 `src/hooks/*`，UI 放 `src/components/*`。
