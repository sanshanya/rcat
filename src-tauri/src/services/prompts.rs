//! Centralized prompts and tool definitions for AI services.
//!
//! This module provides a single source of truth for all AI-related prompts,
//! system messages, and tool definitions. Edit this file to customize AI behavior.

use serde_json::json;

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

/// Default system prompt for the AI assistant
pub const SYSTEM_PROMPT_DEFAULT: &str = r#"你是一个有用的AI助手。请用中文回答用户的问题。"#;

/// System prompt when tool mode is enabled
pub const SYSTEM_PROMPT_WITH_TOOLS: &str = r#"你是一个智能助手，可以通过工具查看用户的屏幕内容。

重要规则：
1. 只有当用户明确需要你查看屏幕、窗口或应用内容时，才使用工具
2. 对于普通对话、问候、知识问答，直接回答即可，不需要使用工具
3. 当需要使用工具时，选择最合适的那个

请用中文回答用户的问题。"#;

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

/// Tool: List all visible windows on user's desktop
pub mod tool_list_windows {
    pub const NAME: &str = "list_visible_windows";
    pub const DESCRIPTION: &str = "获取用户桌面上所有可见窗口的列表。\
        只有当用户明确询问'打开了什么应用'、'有哪些窗口'等问题时才使用。\
        对于普通对话、问候、知识问答等不需要使用此工具。";
}

/// Tool: Capture content from a specific window
pub mod tool_capture_window {
    pub const NAME: &str = "capture_window_content";
    pub const DESCRIPTION: &str = "捕获指定窗口并提取文字内容。\
        只有当用户明确要求查看某个应用的内容时才使用，\
        如'帮我看看QQ消息'、'Chrome上写了什么'。\
        对于普通对话不需要使用此工具。";
    pub const PARAM_WINDOW_TITLE: &str = "window_title";
    pub const PARAM_WINDOW_TITLE_DESC: &str =
        "要捕获的窗口标题（支持模糊匹配，如'QQ'、'微信'、'Chrome'）";
}

/// Tool: Capture currently focused window
pub mod tool_capture_focused {
    pub const NAME: &str = "capture_focused_window";
    pub const DESCRIPTION: &str = "捕获当前焦点窗口并提取文字内容。\
        只有当用户说'这个'、'当前屏幕'、'帮我看看这里'等明确指代当前窗口时才使用。\
        对于普通对话不需要使用此工具。";
}

// ============================================================================
// TOOL SCHEMA BUILDERS
// ============================================================================

/// Build the JSON schema for vision tools.
///
/// When `strict` is enabled (e.g. DeepSeek `/beta`), each function includes `strict: true`
/// and its parameter schema follows strict-mode requirements (`additionalProperties: false`,
/// and all properties listed in `required`).
pub fn build_vision_tools_schema(strict: bool) -> serde_json::Value {
    let mut tools = vec![
        json!({
            "type": "function",
            "function": {
                "name": tool_list_windows::NAME,
                "description": tool_list_windows::DESCRIPTION,
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                    "additionalProperties": false
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": tool_capture_window::NAME,
                "description": tool_capture_window::DESCRIPTION,
                "parameters": {
                    "type": "object",
                    "properties": {
                        tool_capture_window::PARAM_WINDOW_TITLE: {
                            "type": "string",
                            "description": tool_capture_window::PARAM_WINDOW_TITLE_DESC
                        }
                    },
                    "required": [tool_capture_window::PARAM_WINDOW_TITLE],
                    "additionalProperties": false
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": tool_capture_focused::NAME,
                "description": tool_capture_focused::DESCRIPTION,
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                    "additionalProperties": false
                }
            }
        }),
    ];

    if strict {
        for tool in &mut tools {
            if let Some(function) = tool.get_mut("function") {
                if let serde_json::Value::Object(map) = function {
                    map.insert("strict".to_string(), json!(true));
                }
            }
        }
    }

    serde_json::Value::Array(tools)
}

// ============================================================================
// TOOL RESULT FORMATTERS
// ============================================================================

/// Format the result of list_visible_windows tool
pub fn format_window_list(windows: &[(String, String, bool)]) -> String {
    let formatted: Vec<String> = windows
        .iter()
        .map(|(title, app_name, is_focused)| {
            let focus_marker = if *is_focused { " [当前焦点]" } else { "" };
            format!("- {} ({}){}", title, app_name, focus_marker)
        })
        .collect();
    format!("可见窗口列表:\n{}", formatted.join("\n"))
}

/// Format the result of window capture tool
pub fn format_window_capture(window_name: &str, text: &str) -> String {
    format!("窗口 \"{}\" 的内容:\n{}", window_name, text)
}

/// Format the result of focused window capture tool
pub fn format_focused_capture(window_name: &str, text: &str) -> String {
    format!("当前焦点窗口 \"{}\" 的内容:\n{}", window_name, text)
}

/// Format tool execution error
#[allow(dead_code)]
pub fn format_tool_error(error: &str) -> String {
    format!("工具执行失败: {}", error)
}

// ============================================================================
// STREAMING UI MESSAGES
// ============================================================================

/// Message shown when a tool is being called
pub fn tool_call_indicator(tool_name: &str) -> String {
    format!("[调用工具: {}]\n", tool_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_vision_tools_schema() {
        let schema = build_vision_tools_schema(false);
        assert!(schema.is_array());
        let tools = schema.as_array().unwrap();
        assert_eq!(tools.len(), 3);
    }

    #[test]
    fn test_build_vision_tools_schema_strict() {
        let schema = build_vision_tools_schema(true);
        let tools = schema.as_array().unwrap();
        for tool in tools {
            assert_eq!(
                tool.get("function")
                    .and_then(|f| f.get("strict"))
                    .and_then(|s| s.as_bool()),
                Some(true)
            );
            assert_eq!(
                tool.get("function")
                    .and_then(|f| f.get("parameters"))
                    .and_then(|p| p.get("additionalProperties"))
                    .and_then(|v| v.as_bool()),
                Some(false)
            );
        }
    }

    #[test]
    fn test_format_window_list() {
        let windows = vec![
            ("Chrome".to_string(), "chrome.exe".to_string(), true),
            ("VSCode".to_string(), "code.exe".to_string(), false),
        ];
        let result = format_window_list(&windows);
        assert!(result.contains("Chrome"));
        assert!(result.contains("[当前焦点]"));
    }
}
