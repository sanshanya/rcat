use async_openai::traits::RequestOptionsBuilder;
use std::collections::HashMap;

use super::types::ChatRequestOptions;

fn validate_path_override(path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Invalid request path".to_string());
    }
    if path.contains("://") {
        return Err("Request path must be a relative path starting with '/'".to_string());
    }
    if !path.starts_with('/') {
        return Err("Request path must start with '/'".to_string());
    }
    Ok(())
}

fn is_disallowed_header(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "authorization" | "proxy-authorization" | "x-api-key"
    )
}

fn build_header_map(headers: &HashMap<String, String>) -> Result<reqwest::header::HeaderMap, String> {
    let mut header_map = reqwest::header::HeaderMap::new();
    for (key, value) in headers {
        if is_disallowed_header(key) {
            return Err(format!("Header not allowed from frontend: {key}"));
        }
        let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| format!("Invalid header name: {key}"))?;
        let val = reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| format!("Invalid header value for {key}"))?;
        header_map.insert(name, val);
    }
    Ok(header_map)
}

pub(super) fn apply_request_options<T: RequestOptionsBuilder>(
    mut builder: T,
    request_options: &ChatRequestOptions,
) -> Result<T, String> {
    if let Some(path) = request_options.path.as_deref() {
        validate_path_override(path)?;
        builder = builder.path(path).map_err(|e| e.to_string())?;
    }

    if let Some(query) = request_options.query.as_ref() {
        builder = builder.query(query).map_err(|e| e.to_string())?;
    }

    if let Some(headers) = request_options.headers.as_ref() {
        builder = builder.headers(build_header_map(headers)?);
    }

    Ok(builder)
}

