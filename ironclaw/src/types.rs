//! Shared types for IronClaw — Agent IDs, bus messages, error codes, and schemas.
//!
//! This module defines the core data types used across the CalangoFlux Agentic OS
//! for inter-agent communication, error handling, and Redis Streams message formats.

use serde::{Deserialize, Serialize};
use std::fmt;

// =============================================================================
// Agent Identity
// =============================================================================

/// Unique identifier for an agent in the system.
/// Wraps a String for type safety and clarity across the codebase.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AgentId(pub String);

impl AgentId {
    /// Create a new AgentId from a string-like value.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Returns the inner string reference.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AgentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<&str> for AgentId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for AgentId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

// =============================================================================
// Bus Message
// =============================================================================

/// A message transmitted on the Redis Streams message bus.
///
/// Every inter-agent communication goes through BusMessage. The message bus
/// validates that `sender_id`, `destination_id`, and `payload` are present
/// before accepting a message (Requirement 4.5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusMessage {
    /// Unique message identifier (UUID v4).
    pub id: String,
    /// The agent that sent this message.
    pub sender_id: AgentId,
    /// The intended recipient agent.
    pub destination_id: AgentId,
    /// The type/intent of the task (e.g., "conversation", "action", "analysis").
    pub task_type: String,
    /// The message payload (serialized data).
    pub payload: Vec<u8>,
    /// Unix timestamp in milliseconds when the message was created.
    pub timestamp: u64,
}

impl BusMessage {
    /// Validates that the message has all required fields populated.
    /// Returns `true` if the message is valid for bus transmission.
    pub fn is_valid(&self) -> bool {
        !self.id.is_empty()
            && !self.sender_id.as_str().is_empty()
            && !self.destination_id.as_str().is_empty()
            && !self.payload.is_empty()
    }
}

// =============================================================================
// Error Handling
// =============================================================================

/// Error code categories for the CalangoFlux Agentic OS.
///
/// Organized by subsystem:
/// - 1xxx: Authentication/Authorization
/// - 2xxx: Sandbox/Isolation
/// - 3xxx: Message Bus
/// - 4xxx: Agent Lifecycle
/// - 5xxx: Action Execution
/// - 6xxx: Security
/// - 7xxx: Deployment
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u16)]
pub enum ErrorCode {
    // 1xxx — Authentication/Authorization
    Unauthorized = 1001,
    Forbidden = 1002,
    TokenExpired = 1003,

    // 2xxx — Sandbox/Isolation
    SandboxViolation = 2001,
    ResourceExhausted = 2002,
    SandboxTerminated = 2003,

    // 3xxx — Message Bus
    BusUnavailable = 3001,
    MessageRejected = 3002,
    QueueFull = 3003,

    // 4xxx — Agent Lifecycle
    AgentUnhealthy = 4001,
    AgentDead = 4002,
    AgentNotFound = 4003,

    // 5xxx — Action Execution
    ActionTimeout = 5001,
    ActionFailed = 5002,
    RetryExhausted = 5003,

    // 6xxx — Security
    AccessDenied = 6001,
    CredentialExposure = 6002,
    AnomalyDetected = 6003,

    // 7xxx — Deployment
    DeployFailed = 7001,
    RollbackTriggered = 7002,
    VersionNotFound = 7003,
}

impl ErrorCode {
    /// Returns the numeric code value.
    pub fn code(&self) -> u16 {
        *self as u16
    }

    /// Returns the error category name based on the code range.
    pub fn category(&self) -> &'static str {
        match self.code() {
            1001..=1999 => "authentication",
            2001..=2999 => "sandbox",
            3001..=3999 => "message_bus",
            4001..=4999 => "agent_lifecycle",
            5001..=5999 => "action_execution",
            6001..=6999 => "security",
            7001..=7999 => "deployment",
            _ => "unknown",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}({})", self, self.code())
    }
}

/// Structured error response returned by any CalangoFlux component.
///
/// Provides consistent error reporting across the system with enough context
/// for debugging and client-side handling (Requirement 17.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// The specific error code identifying the failure.
    pub code: ErrorCode,
    /// Human-readable error message.
    pub message: String,
    /// The component that generated the error (e.g., "api_gateway", "message_bus").
    pub component: String,
    /// Unix timestamp in milliseconds when the error occurred.
    pub timestamp: u64,
    /// Optional request ID for correlation with client requests.
    pub request_id: Option<String>,
    /// Optional hint for clients: seconds to wait before retrying.
    pub retry_after: Option<u64>,
}

impl ErrorResponse {
    /// Create a new ErrorResponse with the required fields.
    pub fn new(code: ErrorCode, message: impl Into<String>, component: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            component: component.into(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            request_id: None,
            retry_after: None,
        }
    }

    /// Set the request ID for correlation.
    pub fn with_request_id(mut self, request_id: impl Into<String>) -> Self {
        self.request_id = Some(request_id.into());
        self
    }

    /// Set the retry-after hint in seconds.
    pub fn with_retry_after(mut self, seconds: u64) -> Self {
        self.retry_after = Some(seconds);
        self
    }
}

// =============================================================================
// Redis Streams Message Schema
// =============================================================================

/// Redis Streams field names for the task message format.
///
/// Messages on Redis Streams use flat key-value pairs. This module defines
/// the canonical field names used across all CalangoFlux services.
///
/// Stream key pattern: `tasks:{agent_id}`
///
/// Example XADD:
/// ```text
/// XADD tasks:picoclaw * \
///   id "msg-uuid" \
///   sender_id "api-gateway" \
///   destination_id "picoclaw" \
///   task_type "conversation" \
///   payload "<base64-encoded>" \
///   timestamp "1700000000000" \
///   priority "1"
/// ```
pub mod redis_schema {
    // --- Task Stream Fields ---
    /// Stream key prefix for task delivery. Full key: `tasks:{agent_id}`
    pub const STREAM_TASKS_PREFIX: &str = "tasks:";
    /// Stream key prefix for responses. Full key: `responses:{request_id}`
    pub const STREAM_RESPONSES_PREFIX: &str = "responses:";
    /// Stream key prefix for health checks. Full key: `health:{agent_id}`
    pub const STREAM_HEALTH_PREFIX: &str = "health:";
    /// Stream key for security alerts.
    pub const STREAM_ALERTS_SECURITY: &str = "alerts:security";

    // --- Task Message Fields ---
    pub const FIELD_ID: &str = "id";
    pub const FIELD_SENDER_ID: &str = "sender_id";
    pub const FIELD_DESTINATION_ID: &str = "destination_id";
    pub const FIELD_TASK_TYPE: &str = "task_type";
    pub const FIELD_PAYLOAD: &str = "payload";
    pub const FIELD_TIMESTAMP: &str = "timestamp";
    pub const FIELD_PRIORITY: &str = "priority";

    // --- Response Message Fields ---
    pub const FIELD_AGENT_ID: &str = "agent_id";
    pub const FIELD_STATUS: &str = "status";
    pub const FIELD_OUTPUT: &str = "output";
    pub const FIELD_DURATION: &str = "duration";

    // --- Health Check Fields ---
    pub const FIELD_CPU: &str = "cpu";
    pub const FIELD_MEMORY: &str = "memory";

    // --- Security Alert Fields ---
    pub const FIELD_ALERT_TYPE: &str = "type";
    pub const FIELD_SEVERITY: &str = "severity";
    pub const FIELD_DETAILS: &str = "details";

    // --- Consumer Groups ---
    pub const GROUP_PICOCLAW: &str = "picoclaw-workers";
    pub const GROUP_OPENCLAW: &str = "openclaw-workers";
    pub const GROUP_SHIELD: &str = "shield-observers";
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_id_creation() {
        let id = AgentId::new("test-agent");
        assert_eq!(id.as_str(), "test-agent");
        assert_eq!(id.to_string(), "test-agent");
    }

    #[test]
    fn test_agent_id_from_str() {
        let id: AgentId = "picoclaw".into();
        assert_eq!(id.as_str(), "picoclaw");
    }

    #[test]
    fn test_agent_id_equality() {
        let a = AgentId::new("agent-1");
        let b = AgentId::new("agent-1");
        let c = AgentId::new("agent-2");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn test_bus_message_valid() {
        let msg = BusMessage {
            id: "msg-001".to_string(),
            sender_id: AgentId::new("sender"),
            destination_id: AgentId::new("receiver"),
            task_type: "action".to_string(),
            payload: vec![1, 2, 3],
            timestamp: 1700000000000,
        };
        assert!(msg.is_valid());
    }

    #[test]
    fn test_bus_message_invalid_empty_payload() {
        let msg = BusMessage {
            id: "msg-002".to_string(),
            sender_id: AgentId::new("sender"),
            destination_id: AgentId::new("receiver"),
            task_type: "action".to_string(),
            payload: vec![],
            timestamp: 1700000000000,
        };
        assert!(!msg.is_valid());
    }

    #[test]
    fn test_bus_message_invalid_empty_sender() {
        let msg = BusMessage {
            id: "msg-003".to_string(),
            sender_id: AgentId::new(""),
            destination_id: AgentId::new("receiver"),
            task_type: "action".to_string(),
            payload: vec![1],
            timestamp: 1700000000000,
        };
        assert!(!msg.is_valid());
    }

    #[test]
    fn test_bus_message_invalid_empty_destination() {
        let msg = BusMessage {
            id: "msg-004".to_string(),
            sender_id: AgentId::new("sender"),
            destination_id: AgentId::new(""),
            task_type: "action".to_string(),
            payload: vec![1],
            timestamp: 1700000000000,
        };
        assert!(!msg.is_valid());
    }

    #[test]
    fn test_error_code_values() {
        assert_eq!(ErrorCode::Unauthorized.code(), 1001);
        assert_eq!(ErrorCode::Forbidden.code(), 1002);
        assert_eq!(ErrorCode::TokenExpired.code(), 1003);
        assert_eq!(ErrorCode::SandboxViolation.code(), 2001);
        assert_eq!(ErrorCode::ResourceExhausted.code(), 2002);
        assert_eq!(ErrorCode::SandboxTerminated.code(), 2003);
        assert_eq!(ErrorCode::BusUnavailable.code(), 3001);
        assert_eq!(ErrorCode::MessageRejected.code(), 3002);
        assert_eq!(ErrorCode::QueueFull.code(), 3003);
        assert_eq!(ErrorCode::AgentUnhealthy.code(), 4001);
        assert_eq!(ErrorCode::AgentDead.code(), 4002);
        assert_eq!(ErrorCode::AgentNotFound.code(), 4003);
        assert_eq!(ErrorCode::ActionTimeout.code(), 5001);
        assert_eq!(ErrorCode::ActionFailed.code(), 5002);
        assert_eq!(ErrorCode::RetryExhausted.code(), 5003);
        assert_eq!(ErrorCode::AccessDenied.code(), 6001);
        assert_eq!(ErrorCode::CredentialExposure.code(), 6002);
        assert_eq!(ErrorCode::AnomalyDetected.code(), 6003);
        assert_eq!(ErrorCode::DeployFailed.code(), 7001);
        assert_eq!(ErrorCode::RollbackTriggered.code(), 7002);
        assert_eq!(ErrorCode::VersionNotFound.code(), 7003);
    }

    #[test]
    fn test_error_code_categories() {
        assert_eq!(ErrorCode::Unauthorized.category(), "authentication");
        assert_eq!(ErrorCode::SandboxViolation.category(), "sandbox");
        assert_eq!(ErrorCode::BusUnavailable.category(), "message_bus");
        assert_eq!(ErrorCode::AgentUnhealthy.category(), "agent_lifecycle");
        assert_eq!(ErrorCode::ActionTimeout.category(), "action_execution");
        assert_eq!(ErrorCode::AccessDenied.category(), "security");
        assert_eq!(ErrorCode::DeployFailed.category(), "deployment");
    }

    #[test]
    fn test_error_response_creation() {
        let err = ErrorResponse::new(
            ErrorCode::Unauthorized,
            "Invalid token",
            "api_gateway",
        );
        assert_eq!(err.code, ErrorCode::Unauthorized);
        assert_eq!(err.message, "Invalid token");
        assert_eq!(err.component, "api_gateway");
        assert!(err.timestamp > 0);
        assert!(err.request_id.is_none());
        assert!(err.retry_after.is_none());
    }

    #[test]
    fn test_error_response_with_optional_fields() {
        let err = ErrorResponse::new(
            ErrorCode::BusUnavailable,
            "Redis connection lost",
            "message_bus",
        )
        .with_request_id("req-123")
        .with_retry_after(5);

        assert_eq!(err.request_id, Some("req-123".to_string()));
        assert_eq!(err.retry_after, Some(5));
    }

    #[test]
    fn test_error_code_display() {
        let display = format!("{}", ErrorCode::Unauthorized);
        assert!(display.contains("Unauthorized"));
        assert!(display.contains("1001"));
    }

    #[test]
    fn test_bus_message_serialization() {
        let msg = BusMessage {
            id: "msg-ser".to_string(),
            sender_id: AgentId::new("sender"),
            destination_id: AgentId::new("receiver"),
            task_type: "action".to_string(),
            payload: vec![72, 101, 108, 108, 111],
            timestamp: 1700000000000,
        };

        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: BusMessage = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, msg.id);
        assert_eq!(deserialized.sender_id, msg.sender_id);
        assert_eq!(deserialized.destination_id, msg.destination_id);
        assert_eq!(deserialized.payload, msg.payload);
    }
}
