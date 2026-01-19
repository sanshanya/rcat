# P1：OffscreenCanvas + Worker 评估（HitTest Mask）

目标：在不引入“新屎山”的前提下，降低 AvatarWindow 生成 hit-test mask 时的主线程抖动风险（尤其是 `readPixels` 相关 GPU→CPU 同步点），并为后续更激进优化预留接口。

## 现状（V1 已做）

- 默认启用 WebGL2 **PBO + fence** 异步 readback：GPU 侧 `readPixels` 不阻塞主线程，下一帧 `getBufferSubData` 取回（失败自动回退 sync）。
- 前端 CPU 侧仍需要：alpha 阈值化 → 膨胀 → rect → bitset + base64。

结论：在大多数机器上，PBO 已经把 “最大抖动源” 挪走了；剩余 CPU 工作量在 `maxEdge≈160` 的尺寸下通常是 `~1–3ms`，属于可接受范围。

## OffscreenCanvas + Worker 的可行性

### 方案 A：把“渲染 + readback”搬进 Worker（理想但成本高）

要求：

- Worker 内创建 OffscreenCanvas + WebGL2 context
- 把 VRM/材质/纹理/骨骼/动画等渲染资源复制/转移到 Worker

问题：

- three.js renderer 与 VRM runtime 目前都在主线程，资源转移会逼迫我们维护“双渲染管线/双场景”，工程成本极高
- Tauri(WebView2) 的 OffscreenCanvas 支持与性能需要实测，失败时还要维护 fallback

结论：**不推荐在 V1/V2.0 阶段做**，除非我们决定把 Avatar 渲染迁到 native/wgpu（那是另一条路线）。

### 方案 B：只把“CPU 后处理”搬进 Worker（可做、低风险）

做法：

- 主线程仍负责：renderTarget 渲染 + readback（优先 PBO）
- 把 pixels（RGBA）发给 Worker：Worker 负责阈值/膨胀/rect/bitset，回传 bitset（再由主线程 base64 或 Worker 直接 base64）

权衡：

- 需要改造 `MaskGenerator/useHitTestMask` 支持 async pipeline（Promise 或 1 帧延迟）
- 对 fast 模式（33ms）要谨慎：避免引入额外 1 帧 latency 影响命中跟随

建议落地方式：

- **仅在 slow 模式（100ms）启用 Worker 后处理**，fast 模式仍走主线程同步处理（低延迟优先）
- Worker 崩溃/超时直接降级回主线程（fail-open 逻辑不变）

## 推荐结论（本项目）

1. 继续以 **PBO readback** 为主线（已经解决 80% 的抖动风险）。
2. 如果后续出现“主线程偶发卡顿/掉帧”，优先实现 **方案 B（CPU 后处理 Worker）**，并限制只在 slow 模式启用，避免交互延迟。
3. 方案 A 暂不考虑，除非我们决定把 Avatar 渲染从 WebView2 迁走。

