//! Internal "plugin" modules (crate-local sub-systems).
//!
//! These are not Tauri plugins; they are regular Rust modules with a stable
//! boundary so other parts of the app can depend on them without tight coupling.

pub(crate) mod vision;

