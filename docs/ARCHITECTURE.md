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
- `src-tauri/src/services/voice.rs`：TTS/语音播放命令与全局 `VoiceState`（缓存、打断、预热）。

### Frontend（React，`src/`）

- `src/services/*`：对 `invoke` 的 typed wrapper 与自定义 transport。
- `src/hooks/*`：状态与副作用编排（尽量让 `App.tsx` 只做装配）。
- `src/contexts/*`：共享 UI 状态（例如 `ChatUiContext`）。
- `src/components/*`：展示组件 + 少量局部交互。
- `src/styles/index.css`：全局样式（Tailwind v4 theme + 少量 global CSS）。

### Submodule / Workspace（`rcat-voice/`）

- `rcat-voice/`：语音引擎与流式播放管线（Tokenizer → Pipeline → AudioBackend），以 crate 形式被 `src-tauri` 依赖。
  - Windows 上可启用 `gpt-sovits`（libtorch CUDA）后端；其余平台通常走 OS TTS。

## 2) Settings（运行时配置）

- 单一事实来源：`savedata/settings.json`（位于 app 可执行文件旁）。
- Provider profiles：每个 provider 维护 `baseUrl/apiKey/选中 model/model 列表`。
- 环境变量只用于“机器级”配置（不进入 UI）：
  - Turso/libSQL：`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`（或 `LIBSQL_*`）
  - VLM 图片压缩：`VLM_IMAGE_MAX_DIM`、`VLM_JPEG_QUALITY`
  - Voice/TTS：`TTS_BACKEND`、`AUDIO_BACKEND`、`GSV_MODEL_DIR`、`LIBTORCH` 等（见第 7 节）

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

## 7) Voice / TTS（语音输出与低延迟朗读）

rcat 的语音能力来自子模块 crate `rcat-voice`，目标是：

- 手动播放（消息上的 Play）与自动朗读（Input 开关）共用同一套模型实例（避免反复加载）
- 支持“新一轮对话/新的播放”立即打断上一轮（类似 `rcat-voice/examples/terminal_chat.rs` 的行为）
- 尽可能低延迟：LLM streaming delta 直接喂给 TTS 的流式分段与播放管线

### 前端入口

- 自动朗读开关：`src/components/PromptInput.tsx`（`voiceMode`）。
- 消息播放按钮：`src/components/chat/AssistantMessage.tsx` + `src/components/ChatMessages.tsx`（调用 `voicePlayText`）。
- Tauri wrapper：`src/services/voice.ts`（`voicePlayText/voiceStop/voicePrepare`）。
- 每次发起新的 chat request 前，先尝试停止语音（避免串音/重叠）：`src/services/tauriChatTransport.ts`（`invoke("voice_stop")`）。

### 后端入口（Tauri commands）

- `voice_prepare`：预热并缓存引擎（减少首次出声时延）。
- `voice_play_text`：一次性朗读（非 LLM streaming）。
- `voice_stop`：统一停止入口（停止播放 + 取消当前流式会话）。

均在 `src-tauri/src/services/voice.rs`。

### Runtime 组件与状态收口

- `VoiceState`（`src-tauri/src/services/voice.rs`）是语音的“单一事实来源”：
  - `engine.cached`：缓存的 `Arc<dyn TtsEngine>`（模型常驻）。
  - `engine.current`：最近一次使用的弱引用（用于 stop）。
  - `stream`：当前 streaming 会话的取消句柄（用于打断）。
  - `speak_lock`：串行化播放（rodio backend 只支持单 active writer）。

### 自动朗读的数据流（LLM streaming → TTS）

1. 前端开启 `voiceMode` 时调用 `voice_prepare`，提前构建/缓存模型。
2. 发起 `chat_stream`/`chat_stream_with_tools` 时携带 `voice: true`。
3. 后端 `run_chat_generic`（`src-tauri/src/services/ai/tools.rs`）在 `voice_enabled` 时：
   - `VoiceState.cancel_active_stream()`：打断上一轮 streaming。
   - `get_or_build_engine(true)`：拿到并缓存引擎（强制 persist）。
   - `StreamSession::from_env(engine)`：创建流式会话（内部 spawn Tokenizer/Pipeline/Buffer 三个任务）。
   - 将 `StreamCancelHandle` 存入 `VoiceState`，并拿到 `delta_tx` 用于写入 LLM 增量。
4. LLM streaming 每个 `content` delta 到来时：
   - 前端照常 emit `chat-stream(kind=text)` 给 UI。
   - 同时后端把该 delta `send` 给 `delta_tx` → Tokenizer 分段 → Pipeline 调用引擎播放。
5. 请求完成时 drop 掉 `delta_tx`，Tokenizer 会 flush buffer 的尾部文本并退出（保证不丢尾巴）。

### 打断语义（必须成立的 invariants）

- 新请求会打断旧语音：`src/services/tauriChatTransport.ts` 在 invoke chat 前调用 `voice_stop`。
- 手动 Play 会打断 streaming：`voice_play_text` 先 `cancel_active_stream` 再 `engine.stop()`，再开始本次朗读。
- `voice_stop` 是统一入口：同时取消 streaming + 停止引擎播放。

### 常用环境变量（机器级配置）

rcat/rcat-voice 的语音配置主要靠 env（不会写入 settings.json）：

- 引擎选择：`TTS_BACKEND=os|gpt-sovits|gpt-sovits-onnx`（Windows 上常用 `gpt-sovits`）
- 音频后端：`AUDIO_BACKEND=rodio`（以及 `AUDIO_SAMPLE_RATE=32000`、`AUDIO_CHANNELS=1` 等）
- SoVITS 模型：`GSV_MODEL_DIR=/path/to/v2pro`
- libtorch：`LIBTORCH=C:\\libtorch`（并确保 `%LIBTORCH%\\lib` 在 `PATH`）
- 版本检查绕过：`LIBTORCH_BYPASS_VERSION_CHECK=1`（tch/torch-sys 版本不匹配时）
- 模型常驻：`VOICE_PERSIST=1` 或 `RCAT_VOICE_PERSIST=1`（rcat 侧缓存策略仍会优先复用 cached）
- 调试 DLL 预加载：`VOICE_DEBUG_DLL=1`
- 分段/流式调参：`CHUNKER_EAGER_CHUNKS`、`TOKENIZER_MIN_CHARS`、`TOKENIZER_MAX_CHARS`、`TOKENIZER_RELAX_BUFFER_MS`…
- 首段生成调参（SoVITS）：`GSV_FIRST_CHUNK_TOKENS`、`GSV_FIRST_TOP_K`…

## 8) Vision tools（工具模式与屏幕能力）

- 工具模式开关在前端（Input 里的 Eye 按钮），transport 会选择 `chat_stream_with_tools`。
- 后端 `run_chat_generic` 支持 tool rounds：
  - 把工具 schema 注入请求（来自 `crate::plugins::vision`）。
  - 收集 `tool_calls`，执行对应 Rust 工具函数，再把结果作为 `tool` 消息注回上下文继续下一轮。
- 与 UI streaming 的关系：工具调用会向 UI emit 一段“工具提示文本”，让用户知道正在调用工具。

## 9) 类型生成（Rust → TS）

- Rust 侧类型通过 `specta` 派生（feature `typegen`）。
- 生成脚本输出到 `src/bindings/tauri-types.ts`（见 `docs/TYPEGEN.md`）。

## 10) 新功能落地 checklist（推荐）

1. 在 `src-tauri/src/plugins/<feature>/` 实现核心逻辑（内部 API 清晰、可复用）。
2. 通过 `src-tauri/src/services/<feature>.rs` 暴露最小 IPC surface。
3. 前端在 `src/services/<feature>.ts` 建立 typed wrapper（invoke 参数与返回值固定）。
4. 状态/副作用放 `src/hooks/*`，UI 放 `src/components/*`。
