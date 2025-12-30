use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "camelCase"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HistoryError {
    NotFound { message: String },
    Archived { message: String },
    Locked { message: String },
    InvalidInput { message: String },
    Database { message: String },
    Internal { message: String },
}

impl HistoryError {
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound {
            message: message.into(),
        }
    }

    pub fn archived(message: impl Into<String>) -> Self {
        Self::Archived {
            message: message.into(),
        }
    }

    pub fn locked(message: impl Into<String>) -> Self {
        Self::Locked {
            message: message.into(),
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::Database {
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::NotFound { message }
            | Self::Archived { message }
            | Self::Locked { message }
            | Self::InvalidInput { message }
            | Self::Database { message }
            | Self::Internal { message } => message,
        }
    }
}

fn is_db_locked_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("database is locked")
        || lower.contains("sqlite failure: `database is locked`")
        || lower.contains("sqlite_busy")
        || lower.contains("sqlite busy")
        || lower.contains("database is busy")
        || lower.contains("locked")
}

impl From<libsql::Error> for HistoryError {
    fn from(err: libsql::Error) -> Self {
        let message = err.to_string();
        if is_db_locked_error(&message) {
            return Self::locked(message);
        }
        Self::database(message)
    }
}

impl std::fmt::Display for HistoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { message } => write!(f, "NotFound: {}", message),
            Self::Archived { message } => write!(f, "Archived: {}", message),
            Self::Locked { message } => write!(f, "Locked: {}", message),
            Self::InvalidInput { message } => write!(f, "InvalidInput: {}", message),
            Self::Database { message } => write!(f, "Database: {}", message),
            Self::Internal { message } => write!(f, "Internal: {}", message),
        }
    }
}

impl std::error::Error for HistoryError {}
