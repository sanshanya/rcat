**高优先级（真实可能出 bug/体验抖动）**

* **chat_abort**/**chat_abort_conversation** 只 **handle.abort()**，没有确保停掉正在生成/播放的语音；如果此时 SoVITS 的 **spawn_blocking** 仍在跑，可能继续出声（**commands.rs (line 217)**），建议在 abort 路径里也触发 **voice_stop** 或统一在“流任务 Drop/abort”时做语音清理。
* **VoiceState::get_or_build_engine** 存在并发重复加载窗口：两个请求同时进来都可能看到 **cached=None** 然后各自 **build_from_env()**（**voice.rs (line 30)**），建议加“构建中”状态/OnceCell/把 build 串行化。
* **VoiceState.stream** 的 cancel handle 在会话正常结束后不会清空，后续 stop/cancel 会对“已结束会话”重复操作且语义不干净（**voice.rs (line 91)**），建议在 **run_chat_generic** 正常结束时 **set_stream_handle(None)**。

**中优先级（性能/可维护）**

* 模型加载是同步重活：**voice_prepare**/首次 **get_or_build_engine** 可能阻塞 tauri 命令线程（**voice.rs (line 30)**、**App.tsx (line 75)**），建议用 **spawn_blocking**/后台预热并回传状态。
* 前端开新请求时 **voice_stop** 是 fire-and-forget（**tauriChatTransport.ts (line 252)**），追求“绝对立刻打断”可以考虑 **await invoke("voice_stop")** 再发起 **chat_stream**（代价是多一次 await）。
* eager 首段阈值写死 **(10,20,20)**（**tokenizer.rs (line 267)**），如果你们会调参做 A/B，建议也开放成 env 或 config（否则只能改代码）。

**低优先级（工程化/发布风险）**

* 数据目录固定 **<exe_dir>/savedata**（**paths.rs (line 13)**），安装到 **Program Files**/只读目录时可能写失败；发布版更稳的是用系统 AppData 路径。
* API Key 明文落 **settings.json**（见 **config.rs** 逻辑），如果要面向更多用户建议用系统凭据库/加密存储。
* 少量 **unwrap**/**expect** 在生产路径上（例如 **store.rs (line 867)**），理论上异常 DB 状态会 panic；建议改成显式错误返回/兜底
