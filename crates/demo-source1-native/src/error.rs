use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectErrorCode {
    DecodeFailed,
    LimitExceeded,
    InvalidProtocol,
    InvalidTelemetry,
    SerializationFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectError {
    pub version: u32,
    pub code: ProjectErrorCode,
    pub stage: String,
    pub offset: Option<usize>,
    pub message: String,
}

impl ProjectError {
    #[must_use]
    pub fn classify(stage: impl Into<String>, message: impl Into<String>) -> Self {
        Self::classify_at(stage, None, message)
    }

    #[must_use]
    pub fn classify_at(
        stage: impl Into<String>,
        offset: Option<usize>,
        message: impl Into<String>,
    ) -> Self {
        let message = message.into();
        let lower = message.to_ascii_lowercase();
        let code = if lower.contains("limit") || lower.contains("bounds") {
            ProjectErrorCode::LimitExceeded
        } else if lower.contains("protocol") {
            ProjectErrorCode::InvalidProtocol
        } else if lower.contains("decode") || lower.contains("truncated") {
            ProjectErrorCode::DecodeFailed
        } else {
            ProjectErrorCode::InvalidTelemetry
        };
        Self {
            version: 1,
            code,
            stage: stage.into(),
            offset,
            message,
        }
    }

    #[must_use]
    pub fn from_demo(error: &crate::demo::DemoParseError) -> Self {
        use crate::demo::DemoParseErrorCode;
        let code = match error.code {
            DemoParseErrorCode::InputTooLarge
            | DemoParseErrorCode::CommandLimit
            | DemoParseErrorCode::PayloadTooLarge => ProjectErrorCode::LimitExceeded,
            DemoParseErrorCode::UnsupportedDemoProtocol => ProjectErrorCode::InvalidProtocol,
            DemoParseErrorCode::Truncated
            | DemoParseErrorCode::InvalidPayloadLength
            | DemoParseErrorCode::InvalidStamp
            | DemoParseErrorCode::InvalidHeader => ProjectErrorCode::DecodeFailed,
        };
        Self {
            version: 1,
            code,
            stage: "framing".into(),
            offset: Some(error.offset),
            message: error.to_string(),
        }
    }
}

impl fmt::Display for ProjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.stage, self.message)
    }
}

impl std::error::Error for ProjectError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_error_envelope_is_camel_case_and_classified() {
        let error = ProjectError::classify("projection", "observation limit exceeded");
        assert_eq!(error.code, ProjectErrorCode::LimitExceeded);
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "version": 1,
                "code": "LIMIT_EXCEEDED",
                "stage": "projection",
                "offset": null,
                "message": "observation limit exceeded"
            })
        );
    }

    #[test]
    fn classify_at_preserves_the_known_offset() {
        let error = ProjectError::classify_at("network", Some(1_234), "truncated payload");
        assert_eq!(error.code, ProjectErrorCode::DecodeFailed);
        assert_eq!(error.stage, "network");
        assert_eq!(error.offset, Some(1_234));
    }
}
