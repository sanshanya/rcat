# rcat

A modern, fast AI chat application built with **Tauri**, **React**, and **Rust**.

## 🚀 Features

- **Native Performance**: Built on Tauri (Rust) for a lightweight and secure desktop experience.
- **AI Streaming**: Real-time streaming response support for OpenAI-compatible providers (OpenAI, DeepSeek, etc.).
- **Reasoning Support**: Special handling for "reasoning" models (like DeepSeek R1) to display thought processes separate from content.
- **Voice (Optional)**: Microphone ASR + Smart Turn endpointing + streaming TTS via `rcat-voice` (see below).
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

## 🎤 Voice Assistant（Optional）

The Tauri backend integrates the `rcat-voice` subproject (`rcat-voice/`) for low-latency voice input/output.

### Recommended (stable) backend matrix on Windows

- **In-process (Tauri)**: `gpt-sovits-onnx` (CPU) + `asr-sherpa` + optional `turn-smart`
- **CUDA GPT-SoVITS (`gpt-sovits` / libtorch)**: recommended as a **separate process** (`rcat-voice` local worker) and connect via `TTS_BACKEND=remote`, due to observed in-process `0xc0000374 STATUS_HEAP_CORRUPTION` on Windows when mixed with other native libraries.

### Quick setup (PowerShell)

```powershell
# TTS (recommended in-process)
$env:TTS_BACKEND="gpt-sovits-onnx"
$env:GSV_ONNX_MODEL_DIR="E:\rcat\rcat-voice\onnx"

# ASR (sherpa)
$env:ASR_MODELS_ROOT="E:\rcat\rcat-voice\models"
$env:ASR_MODEL="funasr-nano-int8"

# Smart Turn (optional)
$env:SMART_TURN_MODEL="E:\rcat\rcat-voice\models"  # or a specific smart-turn-*.onnx file
$env:SMART_TURN_VARIANT="gpu"                      # when directory has both cpu/gpu models

bun tauri dev
```

Notes:
- Unset `SMART_TURN_MODEL` to disable Smart Turn; the app will fall back to treating each VAD segment as a complete turn.
- Voice model paths can be absolute (recommended) to avoid working-directory ambiguity.
- More details: `rcat-voice/README.md` and `rcat-voice/docs/TROUBLESHOOTING.md`.
- Full voice manual (asr-nano + smartturn + remote gpt-sovits): `docs/VOICE_MANUAL.md`.

### CUDA GPT-SoVITS via local HTTP worker (streaming PCM)

WAV is not used for streaming; the worker streams raw `pcm16le` audio bytes (HTTP chunked transfer).

Terminal 1: start the worker (Windows + CUDA LibTorch)

```powershell
cd rcat-voice

$env:LIBTORCH="C:\\libtorch"
$env:Path="$env:LIBTORCH\\lib;$env:Path"
$env:LIBTORCH_BYPASS_VERSION_CHECK="1"   # optional

$env:GSV_MODEL_DIR="F:\\github\\rcat\\rcat-voice\\v2pro"
$env:TTS_WORKER_BIND="127.0.0.1:7878"

cargo run --bin tts_worker --features tts-worker --release
```

Terminal 2: run the app and use the remote backend

```powershell
cd ..

$env:TTS_BACKEND="remote"
$env:TTS_REMOTE_BASE_URL="http://127.0.0.1:7878"

bun tauri dev
```

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
