# Rust → TypeScript 类型生成（typegen）

本项目的「跨 Tauri 边界」类型（Rust backend ↔️ TS frontend）以 Rust 为唯一来源，通过 `specta` 生成到 TypeScript，避免前后端手写类型漂移。

## 生成方式

- 入口脚本：`src-tauri/src/bin/generate_ts_types.rs`
  - 通过 `TypeCollection::register::<T>()` 显式注册要导出的类型。
  - 仅在启用 `typegen` feature 时执行导出（未启用会直接退出并提示用法）。
- 输出文件：`src/bindings/tauri-types.ts`
  - 该文件为 **生成产物**，不要手工编辑。
  - 修改 Rust 侧桥接类型后，需要重新生成并提交该文件的变更。

## 如何运行

推荐使用前端脚本（本质仍然调用 Cargo）：

```bash
npm run typegen
# or
bun run typegen
```

也可以直接运行 Cargo 命令：

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin generate_ts_types --features typegen
```

## TypeScript 侧规范

- 跨边界类型优先从生成文件导入：
  - 推荐从 `@/types` 导入（`src/types/index.ts` 会 re-export `@/bindings/tauri-types` 的桥接类型）。
  - 只有「纯前端」类型才写在 `src/types/*`，并避免与桥接类型同名/重复定义。
- 对 `Option<T>` 的处理：Rust 的 `Option<T>` 在 TS 侧通常表现为 `T | null`（不是可选字段），使用时按 `null` 分支处理。

## Rust 侧规范（新增/修改桥接类型）

1. 在 Rust 类型上添加 Specta 导出（仅在 `typegen` feature 下启用）：
   - struct：`#[cfg_attr(feature = "typegen", derive(specta::Type))]`
   - 命名风格建议与 TS 对齐：配合 Serde/Specta 使用 `camelCase` 或 `lowercase`（项目内已有示例）。
2. 在 `src-tauri/src/bin/generate_ts_types.rs` 中注册该类型：
   - 只注册确实会被前端使用的类型（Tauri command 入参/出参、事件 payload、共享枚举等）。
3. 重新运行 `typegen` 并提交 `src/bindings/tauri-types.ts` 的更新。

