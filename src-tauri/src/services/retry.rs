use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct RetryConfig {
    pub max_attempts: usize,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl RetryConfig {
    pub fn from_env() -> Self {
        let max_attempts = env_usize("AI_MAX_ATTEMPTS", 5).clamp(1, 20);
        let base_delay = Duration::from_millis(env_u64("AI_RETRY_BASE_DELAY_MS", 250).clamp(0, 60_000));
        let max_delay = Duration::from_millis(env_u64("AI_RETRY_MAX_DELAY_MS", 4_000).clamp(0, 300_000));

        Self {
            max_attempts,
            base_delay,
            max_delay,
        }
    }

    pub fn backoff(&self, attempt: usize) -> Duration {
        // attempt is 1-based (attempt=1 => base_delay)
        if attempt <= 1 {
            return self.base_delay.min(self.max_delay);
        }

        let exp_shift = (attempt - 1).min(30) as u32;
        let base_ms = self.base_delay.as_millis() as u64;
        let raw_ms = base_ms.saturating_mul(1u64 << exp_shift);
        Duration::from_millis(raw_ms).min(self.max_delay)
    }
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(default)
}
