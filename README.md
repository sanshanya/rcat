# rcat

A modern, fast AI chat application built with **Tauri**, **React**, and **Rust**.

## 🚀 Features

-   **Native Performance**: Built on Tauri (Rust) for a lightweight and secure desktop experience.
-   **AI Streaming**: Real-time streaming response support for OpenAI-compatible providers (OpenAI, DeepSeek, etc.).
-   **Reasoning Support**: Special handling for "reasoning" models (like DeepSeek R1) to display thought processes separate from content.
-   **Window Management**:
    -   **Mini Mode**: A small capsule for quick access.
    -   **Input Mode**: specialized input window that auto-expands.
    -   **Result Mode**: Full chat interface.
-   **Click-Through**: "Ghost mode" to overlay the chat on other windows without blocking interactions.

## 🛠️ Architecture

-   **Frontend**: React 19, TypeScript, TailwindCSS v4, Framer Motion.
-   **Backend**: Tauri v2 (Rust).
-   **Communication**: Custom Tauri commands and event streams (`chat-stream`, `chat-error`, `chat-done`).

## 📋 Prerequisites

Before you start, ensure you have the following installed:

-   **[Node.js](https://nodejs.org/)** or **[Bun](https://bun.sh/)** (Recommended)
-   **[Rust](https://www.rust-lang.org/tools/install)** (Required for Tauri)
-   **[VS Code](https://code.visualstudio.com/)** with `rust-analyzer` and `Tauri` extensions.

## ⚙️ Configuration

Create a `.env` file in the root directory (copy from `.env.example`):

```bash
cp .env.example .env
```

Configure your AI provider:

```env
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=your_api_key_here
AI_MODEL=deepseek-reasoner
# Options: openai, deepseek, compatible
AI_PROVIDER=deepseek
```

### VLM Screenshot Optimization (Optional)

When using `analyze_screen_vlm`, screenshots are JPEG-compressed and optionally downscaled before Base64 encoding to reduce payload size and latency.

```env
# Max width/height in pixels (0 = no resize)
VLM_IMAGE_MAX_DIM=1280

# JPEG quality (1-100)
VLM_JPEG_QUALITY=70
```

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
