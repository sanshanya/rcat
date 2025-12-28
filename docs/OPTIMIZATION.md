# Optimization Directions (rcat)

This document records potential optimization/refactor directions for later work. It is intentionally scoped to **Windows-only** + **Tauri v2** and reflects the current “capsule → expand downward” product direction.

## Principles

- Prefer **layout-driven sizing** over hard-coded pixel math.
- Treat long-running work as **background tasks**; UI can collapse without interrupting generation.
- Keep per-feature code behind a stable boundary (`plugins/`, `services/`) to reduce coupling.
- Optimize for “fast by default”: avoid holding scarce resources (DB connections, window locks) across network calls.

## Non-goals (deferred)

- “Reduce IPC/event pressure” is intentionally postponed for now.

## Backend (Rust / Tauri)

### 1) History persistence (libSQL / Turso)

Current implementation: `src-tauri/src/plugins/history/store.rs` (libSQL client with remote + local fallback).

**High value**
- **Pagination / lazy-loading messages**: avoid loading full conversations for long histories; add `before_seq`/`limit` APIs.
- **Prepared statements for hot paths**: especially `sync_from_frontend_messages` (per-message upsert loop) to reduce parse/plan cost and remote RTT amplification.
- **Denormalize conversation metadata**: store `message_count`, `last_message_at_ms`, maybe `last_role` in `conversations` to avoid `LEFT JOIN + COUNT` for list view.
- **Structured error types**: replace `Result<T, String>` with a `HistoryError` enum so the frontend can act on “locked”, “not found”, “archived”, etc.

**Medium value**
- **Title generation hardening**:
  - Track “title generation attempted/failed” to avoid repeated “Empty title from model” logs.
  - Add exponential backoff or “cooldown window” per conversation.
  - Keep title generation on a dedicated non-reasoning model (already done), but allow per-provider overrides.
- **Migration + schema evolution discipline**: keep a version table; ensure forward-compatible migrations.
- **Indexes review**: validate query plans for list/detail queries and message lookups; add missing indexes as needed.

**Notes / practices**
- Never hold DB connections across network calls (AI title generation, remote sync).
- Remote mode should avoid global serialization; local mode may still need write gating to reduce `SQLITE_BUSY`.

### 2) AI streaming correctness (multi-conversation)

Relevant files: `src-tauri/src/services/ai/*`, `src/services/tauriChatTransport.ts`.

- Ensure each conversation has an **independent stream lifecycle** (start/stop), so switching conversations never “steals” state.
- Consider a per-conversation `StreamTaskRegistry` (map `conversation_id -> task handle + abort`) with explicit cancellation semantics.
- Persist “streaming in progress” state in memory only (not DB) and keep history syncing robust to concurrent writes.

### 3) Vision as a plugin boundary

Current plugin layout: `src-tauri/src/plugins/vision/*`.

- Keep Vision behind a feature flag (compile-time + runtime) so it can be disabled without touching core chat/history.
- Keep tool registration isolated in the plugin; the AI tool executor should not need to know capture/OCR internals.

### 4) Observability & diagnostics

- Normalize log targets (`app_lib::...`) and add structured context fields (conversation_id, request_id).
- Add a “debug dump” command: export DB schema + latest N logs + basic config (sanitized) to help triage issues.

## Frontend (React / Vite / Tailwind)

### 1) Layout & sizing (stop hard-coded width/height)

Goal: window size should be driven by component layout constraints.

- Prefer **CSS layout** (flex/grid) + Tailwind over JS “math sizing”.
- Use `min-h`/`max-h` derived from viewport constraints (screen %) rather than hard-coded constants.
- For textarea growth:
  - Keep `maxHeight` as a fraction of available height.
  - Prefer a small, well-tested autosize strategy (library or minimal custom) with clear constraints.

### 2) Scroll behavior (streaming + conversation switch)

Goal: mature chat UX.

- On “Send”:
  - Force stick-to-bottom (for a short window) so the user always sees the assistant reply start.
- During streaming:
  - Stay pinned to bottom unless the user scrolls up (then respect user intent).
- On conversation switch:
  - Default to bottom (unless later adding “restore last scroll position”).

### 3) State boundaries / decoupling

- Split `src/App.tsx` responsibilities:
  - “Layout shell” vs “conversation state” vs “window mode FSM”.
- Introduce a small context layer (e.g., `ChatContext`) to reduce prop drilling (conversations, active id, model, tool mode).
- Keep “history dropdown”, “model selector”, “settings” as independent components with minimal shared state.

### 4) UX rules & invariants

- UI can collapse while generating; generation must continue in background.
- If the user is already viewing a conversation, do **not** show the “unseen” dot for that conversation.
- Unseen dot belongs on the **model icon** (e.g., DeepSeek), not only inside nested menus.
- “Stop” vs “Send”:
  - When a conversation is generating, the primary action should be **Stop** for that conversation.

### 5) Styling consistency (Tailwind-only direction)

- Continue migrating any remaining ad-hoc CSS to Tailwind utilities.
- Keep reusable styling primitives in `src/components/ui/*` and avoid bespoke per-page CSS.

### 6) Testing hygiene

- Ensure unit tests that need DOM run under `jsdom` (Vitest environment).
- Add a few high-value interaction tests:
  - streaming scroll-to-bottom
  - switching conversations while streaming
  - delete history entry does not change active conversation unintentionally

## Suggested Milestones (later)

1. **History pagination** + list performance (denormalize metadata).
2. **Prepared statements** + schema/versioning for history DB.
3. **AI multi-conversation stream registry** (strong correctness around switching/stop/send).
4. Frontend architecture split (`App.tsx` shrink) + Tailwind consistency pass.

