# VRM Expressions & Emotions / 表情与情感系统

目标：把“模型各自的表情命名差异”与“产品需要的情感语义”解耦，形成一套**可绑定、可持久化、可被 AI 调用**的表情/情感控制层。

## 核心概念

### 1) 表情槽（Internal Expression Slots）

rcat 在代码里使用一组**稳定的内部表情槽**（`ExpressionName`），例如：

- 口型：`aa/ih/ou/ee/oh`
- 程序化：`blink`
- 情绪/表情：`happy/sad/angry/relaxed/surprised/blush/neutral/shy/anxious/confused`

这些槽位不是 VRM 文件里的真实名字，而是我们统一后的“语义入口”。

### 2) 模型表情名（Model Expression Names）

不同模型/不同 VRM 版本的表情命名会不一致（例如有的叫 `Sorrow`，有的叫 `sad`，有的自定义为 `mySadFace`）。

Debug 面板的 `Expressions` 列表会展示模型里实际存在的 expression name，并给出可用绑定数（bindings count）帮助判断是否真的能驱动。

### 3) Bindings（把内部槽映射到模型真实表情）

Bindings 是一张表：`内部表情槽 -> 模型 expression name`，按 VRM URL 持久化。

- 自动：`ExpressionDriver` 会用内置 alias 猜测常见名字（例如 `Sorrow (sad)`）。
- 手动：Debug → `Bindings` 可以覆盖自动结果，确保对每个模型都可控。

### 4) Emotion（8 类情感）

内部统一 8 类情感（`EmotionId`）：

- `neutral/happy/sad/angry/shy/surprised/anxious/confused`

每个情感有一个强度 `intensity`（0～2），由 `buildEmotionExpressions` 生成表情权重配方，写入 `ExpressionMixer.base` 通道。

> 注意：如果模型缺少某个表情槽（例如没有 `neutral`），该槽会被跳过，不会导致崩溃。

## 表情混合（避免打架）

`ExpressionMixer` 将多路来源统一合成（取 max）：

- `base`：情感（Emotion）
- `hover`：鼠标悬停互动（zones）
- `blink`：眨眼
- `mouth`：口型（AA）
- `manual`：Debug 手动 override

这样 hover/眨眼/口型不会互相覆盖，也不会与情感语义“抢写表情”。

## 二值表情（Binary Expressions）

部分模型的 expression 是二值型：`> 0.5` 才明显生效、`< 0.5` 看起来“像没变化”。

rcat 不依赖黑盒：你可以在 Debug → `Expressions` 用 raw slider 验证某个 expression 是否需要“过阈值”。

建议做法：

- 对这种表情，Bindings 时优先把它绑定到我们会直接给到 `1.0` 的槽位（例如 `happy/sad/angry/blush`）。
- 需要微调时，用 Emotion 的 `intensity` 把组合项推过阈值（例如 `0.55`）。

## 情感 → 动作（可选）

Debug → `Emotion` 支持把每个情感映射到一个 motion（按 VRM URL 持久化）：

- 切换情感时：如果当前没有手动播放动作，会自动尝试播放该情感的 motion。
- 如果手动在 Debug → `Motion` 播放了动作：情感不会抢占（避免打架）。

## 面向 AI 的调用入口

推荐通过 `src/components/vrm/emotionApi.ts` 调用：

```ts
import { setVrmEmotion, setVrmEmotionFromLabel } from "@/components/vrm/emotionApi";

setVrmEmotion("happy", { intensity: 1 });
setVrmEmotionFromLabel("开心", { intensity: 0.8 });
```

这样 AI/外部模块不需要关心 VRM 的真实表情名字，也不需要直接触碰 `ExpressionMixer`。

## 持久化

Tauri（`savedata/settings.json`）：

- `vrm.expressionBindings[url]`：Bindings（按模型 URL）
- `vrm.emotionProfiles[url]`：Emotion → Motion 映射（按模型 URL）

Web / 兜底（`localStorage`）：

- `rcat.vrm.expressionBindings:<encodedUrl>`
- `rcat.vrm.emotionProfile:<encodedUrl>`

