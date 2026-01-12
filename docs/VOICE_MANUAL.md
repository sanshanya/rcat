# 语音手工联调（Windows）

目标组合：`asr-nano (FunASR Nano int8)` + `smartturn` + `gpt-sovits(CUDA, remote worker)`。

## 终端 1：启动 GPT-SoVITS CUDA Worker（流式 PCM16）

```powershell
cd rcat-voice

$env:LIBTORCH="C:\libtorch"
$env:Path="$env:LIBTORCH\lib;$env:Path"
$env:LIBTORCH_BYPASS_VERSION_CHECK="1"   # 可选：torch-sys 版本校验不一致时

$env:RCAT_MODELS_DIR="F:\github\rcat\models"
$env:TTS_WORKER_BIND="127.0.0.1:7878"

$env:TTS_WORKER_METRICS="1"              # 可选：打印 req ttfb/gen/rtf
$env:RUST_LOG="info,rcat_voice=info,gpt_sovits_rs=info"

cargo run --bin tts_worker --features tts-worker --release
```

健康检查：`curl http://127.0.0.1:7878/health` → `ok`

## 终端 2：启动 App（Tauri）

```powershell
cd F:\github\rcat

# Remote TTS（仍然在本机播放音频，只是推理在 worker 进程）
$env:TTS_BACKEND="remote"
$env:TTS_REMOTE_BASE_URL="http://127.0.0.1:7878"

# Audio（rodio）
$env:AUDIO_BACKEND="rodio"
$env:AUDIO_SAMPLE_RATE="32000"
$env:AUDIO_CHANNELS="1"

# Unified models root (contains ASR/TTS/TURN/VAD)
$env:RCAT_MODELS_DIR="F:\github\rcat\models"

# ASR（FunASR Nano int8 via sherpa-onnx）
$env:ASR_MODEL="funasr-nano-int8"

# Smart Turn（ONNX）
$env:SMART_TURN_VARIANT="gpu"            # when models/TURN has both cpu/gpu

# 可选：指标/日志
$env:VOICE_TTS_METRICS="1"
$env:RUST_LOG="info,app_lib=debug,rcat_voice=info"

bun tauri dev
```

## 验收点

- 点麦克风图标进入 Listening；若秒退回 Idle，输入框下方会显示具体错误（Mic/ASR/SmartTurn 初始化失败等）。
- 说完一句话后：
  - ASR 会通过事件持续推送 `turnText`
  - SmartTurn 判定 turn end 后触发发送到 LLM
  - TTS 通过 worker 进行推理并流式播放
