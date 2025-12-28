use async_openai::error::OpenAIError;

pub(super) fn should_retry_openai_error(err: &OpenAIError) -> bool {
    match err {
        OpenAIError::Reqwest(e) => e.is_timeout() || e.is_connect(),
        OpenAIError::StreamError(_) => true,
        OpenAIError::JSONDeserialize(_, _) => true,
        OpenAIError::ApiError(api) => {
            let msg = api.message.to_ascii_lowercase();
            let code = api.code.as_deref().unwrap_or("").to_ascii_lowercase();
            let ty = api.r#type.as_deref().unwrap_or("").to_ascii_lowercase();

            msg.contains("rate limit")
                || msg.contains("too many")
                || msg.contains("429")
                || msg.contains("overload")
                || msg.contains("temporarily")
                || msg.contains("timeout")
                || code.contains("rate")
                || code.contains("timeout")
                || code.contains("overload")
                || ty.contains("rate")
                || ty.contains("timeout")
        }
        _ => false,
    }
}
