# rcat

A modern, fast AI chat application built with **Tauri**, **React**, and **Rust**.

## 🚀 Features

- **Native Performance**: Built on Tauri (Rust) for a lightweight and secure desktop experience.
- **AI Streaming**: Real-time streaming response support for OpenAI-compatible providers (OpenAI, DeepSeek, etc.).
- **Reasoning Support**: Special handling for "reasoning" models (like DeepSeek R1) to display thought processes separate from content.
- **Window Management**:
  - **Mini Mode**: A small capsule for quick access.
  - **Input Mode**: specialized input window that auto-expands.
  - **Result Mode**: Full chat interface.
- **Click-Through**: "Ghost mode" to overlay the chat on other windows without blocking interactions.

## 🛠️ Architecture

- **Frontend**: React 19, TypeScript, TailwindCSS v4, Framer Motion.
- **Backend**: Tauri v2 (Rust).
- **Communication**: Custom Tauri commands and event streams (`chat-stream`, `chat-error`, `chat-done`).

## 📋 Prerequisites

Before you start, ensure you have the following installed:

- **[Node.js](https://nodejs.org/)** (>= 20.19.0) or **[Bun](https://bun.sh/)** (Recommended)
- **[Rust](https://www.rust-lang.org/tools/install)** (Required for Tauri)
- **[VS Code](https://code.visualstudio.com/)** with `rust-analyzer` and `Tauri` extensions.

## ⚙️ Configuration

AI provider settings are configured inside the app (Settings) and stored in `savedata/settings.json` next to the app executable.

### VLM Screenshot Optimization (Optional)

When using `analyze_screen_vlm`, screenshots are JPEG-compressed and optionally downscaled before Base64 encoding to reduce payload size and latency.

Set via environment variables:

- `VLM_IMAGE_MAX_DIM` (0 = no resize)
- `VLM_JPEG_QUALITY` (1-100)

### Conversation History Storage (Optional)

When configured, conversation history is stored in a remote Turso/libSQL database; otherwise it falls back to a local `savedata/history.db`.

Set via environment variables:

- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
- or `LIBSQL_DATABASE_URL` / `LIBSQL_AUTH_TOKEN`

### Rust → TypeScript Types (Optional)

Shared bridge types are generated into `src/bindings/tauri-types.ts`.

```bash
npm run typegen
# or
cargo run --manifest-path src-tauri/Cargo.toml --bin generate_ts_types --features typegen
```

## 🏃‍♂️ Development

Install dependencies:

```bash
bun install
```

Run the development server (Frontend + Backend):

```bash
bun tauri dev
```

## 🧪 Testing

Run frontend unit tests:

```bash
bun test
```

Run backend Rust tests:

```bash
cd src-tauri
cargo test
```
