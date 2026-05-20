//! Access Control — Zero-Trust inter-agent communication validation.
//!
//! Implements the access control matrix for CalangoVallum, validating every
//! inter-agent message before delivery. Default policy is deny-all (zero-trust).
//!
//! On violation: blocks message, logs to CHAIN, alerts SHIELD.
//! Supports runtime configuration updates without restart (Requirement 16.4).

use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;
use tokio::sync::RwLock;

// =============================================================================
// Core Types
// =============================================================================

/// A single rule in the access control matrix.
///
/// Defines whether a `source` agent is allowed to send messages to a
/// `destination` agent. CalangoVallum validates every message against
/// the matrix before delivery (Requirement 16.1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessRule {
    /// The agent attempting to send a message.
    pub source: String,
    /// The intended recipient agent.
    pub destination: String,
    /// Whether this communication path is permitted.
    pub allowed: bool,
}

impl AccessRule {
    /// Create a new access rule.
    pub fn new(source: impl Into<String>, destination: impl Into<String>, allowed: bool) -> Self {
        Self {
            source: source.into(),
            destination: destination.into(),
            allowed,
        }
    }

    /// Create a rule that allows communication between source and destination.
    pub fn allow(source: impl Into<String>, destination: impl Into<String>) -> Self {
        Self::new(source, destination, true)
    }

    /// Create a rule that denies communication between source and destination.
    pub fn deny(source: impl Into<String>, destination: impl Into<String>) -> Self {
        Self::new(source, destination, false)
    }
}

// =============================================================================
// Access Control Matrix
// =============================================================================

/// The access control matrix holding all rules.
///
/// Used by CalangoVallum to validate inter-agent communication.
/// Default policy is deny-all (zero-trust).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccessControlMatrix {
    rules: Vec<AccessRule>,
}

impl AccessControlMatrix {
    /// Create a new empty matrix (default: deny all).
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    /// Create a matrix from a list of rules.
    pub fn from_rules(rules: Vec<AccessRule>) -> Self {
        Self { rules }
    }

    /// Check if a source agent is allowed to send messages to a destination agent.
    ///
    /// Returns `false` (deny) if no explicit rule exists (zero-trust default).
    pub fn is_allowed(&self, source: &str, destination: &str) -> bool {
        self.rules
            .iter()
            .find(|r| r.source == source && r.destination == destination)
            .map(|r| r.allowed)
            .unwrap_or(false) // Default: deny
    }

    /// Add a rule to the matrix. Replaces any existing rule for the same pair.
    pub fn add_rule(&mut self, rule: AccessRule) {
        self.rules
            .retain(|r| !(r.source == rule.source && r.destination == rule.destination));
        self.rules.push(rule);
    }

    /// Remove a rule for a specific source/destination pair.
    /// After removal, the default deny policy applies for that pair.
    pub fn remove_rule(&mut self, source: &str, destination: &str) {
        self.rules
            .retain(|r| !(r.source == source && r.destination == destination));
    }

    /// Update an existing rule's allowed status. If no rule exists, adds a new one.
    pub fn update_rule(&mut self, source: &str, destination: &str, allowed: bool) {
        if let Some(rule) = self
            .rules
            .iter_mut()
            .find(|r| r.source == source && r.destination == destination)
        {
            rule.allowed = allowed;
        } else {
            self.rules.push(AccessRule::new(source, destination, allowed));
        }
    }

    /// Returns all rules in the matrix.
    pub fn rules(&self) -> &[AccessRule] {
        &self.rules
    }

    /// Returns the number of rules in the matrix.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Returns true if the matrix has no rules.
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

// =============================================================================
// Matrix Storage Trait
// =============================================================================

/// Error type for matrix storage operations.
#[derive(Debug, Clone, thiserror::Error)]
pub enum StorageError {
    #[error("failed to load matrix: {0}")]
    LoadFailed(String),
    #[error("failed to save matrix: {0}")]
    SaveFailed(String),
    #[error("connection error: {0}")]
    ConnectionError(String),
}

/// Trait for persisting and loading the access control matrix.
///
/// Enables runtime updates from the Admin Dashboard without restart
/// (Requirement 16.4). Implementations can back onto Supabase, Redis, or
/// any other storage backend.
#[async_trait::async_trait]
pub trait MatrixStorage: Send + Sync {
    /// Load the current access control matrix from storage.
    async fn load_matrix(&self) -> Result<AccessControlMatrix, StorageError>;

    /// Save the access control matrix to storage.
    async fn save_matrix(&self, matrix: &AccessControlMatrix) -> Result<(), StorageError>;
}

// =============================================================================
// Access Violation
// =============================================================================

/// Represents an access control violation event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessViolation {
    /// The agent that attempted to send the message.
    pub source: String,
    /// The intended destination agent.
    pub destination: String,
    /// Human-readable reason for the violation.
    pub reason: String,
    /// Unix timestamp in milliseconds when the violation occurred.
    pub timestamp: u64,
}

impl fmt::Display for AccessViolation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "AccessViolation: {} -> {} denied ({})",
            self.source, self.destination, self.reason
        )
    }
}

// =============================================================================
// Validation Result
// =============================================================================

/// Result of validating a message against the access control matrix.
#[derive(Debug, Clone)]
pub enum ValidationResult {
    /// Message is allowed to proceed.
    Allowed,
    /// Message is blocked due to an access control violation.
    Denied(AccessViolation),
}

impl ValidationResult {
    /// Returns true if the message is allowed.
    pub fn is_allowed(&self) -> bool {
        matches!(self, ValidationResult::Allowed)
    }

    /// Returns true if the message is denied.
    pub fn is_denied(&self) -> bool {
        matches!(self, ValidationResult::Denied(_))
    }
}

// =============================================================================
// Message representation for validation
// =============================================================================

/// A message to be validated against the access control matrix.
///
/// This is a lightweight representation used for validation purposes.
/// The actual message payload is not needed for access control checks.
#[derive(Debug, Clone)]
pub struct MessageToValidate {
    /// The agent sending the message.
    pub sender_id: String,
    /// The intended recipient agent.
    pub destination_id: String,
    /// Unix timestamp in milliseconds.
    pub timestamp: u64,
}

// =============================================================================
// Access Control Validator
// =============================================================================

/// Validates inter-agent messages against the access control matrix.
///
/// Uses an `Arc<RwLock<AccessControlMatrix>>` to support runtime configuration
/// updates without restart (Requirement 16.4). The matrix can be updated
/// concurrently while validation continues.
///
/// On violation:
/// - Blocks the message (returns `ValidationResult::Denied`)
/// - Logs to CHAIN (caller responsibility via returned violation)
/// - Alerts SHIELD (caller responsibility via returned violation)
#[derive(Clone)]
pub struct AccessControlValidator {
    matrix: Arc<RwLock<AccessControlMatrix>>,
}

impl AccessControlValidator {
    /// Create a new validator with the given matrix.
    pub fn new(matrix: AccessControlMatrix) -> Self {
        Self {
            matrix: Arc::new(RwLock::new(matrix)),
        }
    }

    /// Create a new validator from a shared matrix reference.
    pub fn from_shared(matrix: Arc<RwLock<AccessControlMatrix>>) -> Self {
        Self { matrix }
    }

    /// Validate a message against the access control matrix.
    ///
    /// Returns `ValidationResult::Allowed` if the sender has permission to
    /// communicate with the destination, or `ValidationResult::Denied` with
    /// an `AccessViolation` if not.
    ///
    /// On violation: the caller should block the message, log to CHAIN, and
    /// alert SHIELD.
    pub async fn validate_message(&self, msg: &MessageToValidate) -> ValidationResult {
        let matrix = self.matrix.read().await;

        if matrix.is_allowed(&msg.sender_id, &msg.destination_id) {
            ValidationResult::Allowed
        } else {
            let violation = AccessViolation {
                source: msg.sender_id.clone(),
                destination: msg.destination_id.clone(),
                reason: format!(
                    "No allow rule for {} -> {} in access control matrix (zero-trust default deny)",
                    msg.sender_id, msg.destination_id
                ),
                timestamp: msg.timestamp,
            };
            tracing::warn!(
                source = %violation.source,
                destination = %violation.destination,
                "Access control violation: message blocked, logging to CHAIN and alerting SHIELD"
            );
            ValidationResult::Denied(violation)
        }
    }

    /// Update the access control matrix at runtime without restart.
    ///
    /// This supports Requirement 16.4: the Admin Dashboard can push
    /// configuration updates that take effect immediately.
    pub async fn update_matrix(&self, new_matrix: AccessControlMatrix) {
        let mut matrix = self.matrix.write().await;
        *matrix = new_matrix;
        tracing::info!("Access control matrix updated at runtime");
    }

    /// Add a single rule to the matrix at runtime.
    pub async fn add_rule(&self, rule: AccessRule) {
        let mut matrix = self.matrix.write().await;
        matrix.add_rule(rule);
    }

    /// Remove a rule from the matrix at runtime.
    pub async fn remove_rule(&self, source: &str, destination: &str) {
        let mut matrix = self.matrix.write().await;
        matrix.remove_rule(source, destination);
    }

    /// Update a rule in the matrix at runtime.
    pub async fn update_rule(&self, source: &str, destination: &str, allowed: bool) {
        let mut matrix = self.matrix.write().await;
        matrix.update_rule(source, destination, allowed);
    }

    /// Reload the matrix from storage (for runtime updates from Admin Dashboard).
    pub async fn reload_from_storage(
        &self,
        storage: &dyn MatrixStorage,
    ) -> Result<(), StorageError> {
        let new_matrix = storage.load_matrix().await?;
        self.update_matrix(new_matrix).await;
        Ok(())
    }

    /// Get a snapshot of the current matrix (for inspection/debugging).
    pub async fn get_matrix_snapshot(&self) -> AccessControlMatrix {
        self.matrix.read().await.clone()
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // AccessRule tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_access_rule_creation() {
        let rule = AccessRule::new("picoclaw", "openclaw", true);
        assert_eq!(rule.source, "picoclaw");
        assert_eq!(rule.destination, "openclaw");
        assert!(rule.allowed);
    }

    #[test]
    fn test_access_rule_allow_deny_helpers() {
        let allow = AccessRule::allow("a", "b");
        assert!(allow.allowed);

        let deny = AccessRule::deny("a", "b");
        assert!(!deny.allowed);
    }

    // -------------------------------------------------------------------------
    // AccessControlMatrix tests — zero-trust default deny
    // -------------------------------------------------------------------------

    #[test]
    fn test_matrix_default_deny() {
        let matrix = AccessControlMatrix::new();
        assert!(
            !matrix.is_allowed("unknown-agent", "target"),
            "Default policy should deny unknown pairs"
        );
    }

    #[test]
    fn test_matrix_default_deny_empty_strings() {
        let matrix = AccessControlMatrix::new();
        assert!(!matrix.is_allowed("", ""));
        assert!(!matrix.is_allowed("agent", ""));
        assert!(!matrix.is_allowed("", "agent"));
    }

    // -------------------------------------------------------------------------
    // AccessControlMatrix tests — allow/deny rules
    // -------------------------------------------------------------------------

    #[test]
    fn test_matrix_explicit_allow() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow("picoclaw", "openclaw"));
        assert!(matrix.is_allowed("picoclaw", "openclaw"));
    }

    #[test]
    fn test_matrix_explicit_deny() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::deny("rogue", "vault"));
        assert!(!matrix.is_allowed("rogue", "vault"));
    }

    #[test]
    fn test_matrix_rule_replacement() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow("a", "b"));
        assert!(matrix.is_allowed("a", "b"));

        // Replace with deny
        matrix.add_rule(AccessRule::deny("a", "b"));
        assert!(!matrix.is_allowed("a", "b"));
        assert_eq!(matrix.len(), 1, "Should replace, not duplicate");
    }

    #[test]
    fn test_matrix_remove_rule() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow("a", "b"));
        assert_eq!(matrix.len(), 1);

        matrix.remove_rule("a", "b");
        assert_eq!(matrix.len(), 0);
        // After removal, default deny applies
        assert!(!matrix.is_allowed("a", "b"));
    }

    #[test]
    fn test_matrix_update_rule_existing() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow("a", "b"));
        assert!(matrix.is_allowed("a", "b"));

        matrix.update_rule("a", "b", false);
        assert!(!matrix.is_allowed("a", "b"));
        assert_eq!(matrix.len(), 1);
    }

    #[test]
    fn test_matrix_update_rule_new() {
        let mut matrix = AccessControlMatrix::new();
        matrix.update_rule("x", "y", true);
        assert!(matrix.is_allowed("x", "y"));
        assert_eq!(matrix.len(), 1);
    }

    #[test]
    fn test_matrix_multiple_rules() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("gateway", "picoclaw"),
            AccessRule::allow("picoclaw", "openclaw"),
            AccessRule::allow("picoclaw", "gemini"),
            AccessRule::deny("openclaw", "vault"),
        ]);

        assert!(matrix.is_allowed("gateway", "picoclaw"));
        assert!(matrix.is_allowed("picoclaw", "openclaw"));
        assert!(matrix.is_allowed("picoclaw", "gemini"));
        assert!(!matrix.is_allowed("openclaw", "vault"));
        // Not in matrix → deny
        assert!(!matrix.is_allowed("openclaw", "picoclaw"));
    }

    #[test]
    fn test_matrix_serialization() {
        let matrix = AccessControlMatrix::from_rules(vec![AccessRule::allow("a", "b")]);

        let json = serde_json::to_string(&matrix).unwrap();
        let deserialized: AccessControlMatrix = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.len(), 1);
        assert!(deserialized.is_allowed("a", "b"));
    }

    // -------------------------------------------------------------------------
    // AccessControlValidator tests — runtime updates
    // -------------------------------------------------------------------------

    #[tokio::test]
    async fn test_validator_allows_permitted_message() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("picoclaw", "openclaw"),
        ]);
        let validator = AccessControlValidator::new(matrix);

        let msg = MessageToValidate {
            sender_id: "picoclaw".to_string(),
            destination_id: "openclaw".to_string(),
            timestamp: 1700000000000,
        };

        let result = validator.validate_message(&msg).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_validator_denies_unpermitted_message() {
        let matrix = AccessControlMatrix::new(); // empty = deny all
        let validator = AccessControlValidator::new(matrix);

        let msg = MessageToValidate {
            sender_id: "rogue".to_string(),
            destination_id: "vault".to_string(),
            timestamp: 1700000000000,
        };

        let result = validator.validate_message(&msg).await;
        assert!(result.is_denied());

        if let ValidationResult::Denied(violation) = result {
            assert_eq!(violation.source, "rogue");
            assert_eq!(violation.destination, "vault");
            assert!(violation.reason.contains("zero-trust default deny"));
        }
    }

    #[tokio::test]
    async fn test_validator_denies_explicit_deny_rule() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::deny("malicious", "target"),
        ]);
        let validator = AccessControlValidator::new(matrix);

        let msg = MessageToValidate {
            sender_id: "malicious".to_string(),
            destination_id: "target".to_string(),
            timestamp: 1700000000000,
        };

        let result = validator.validate_message(&msg).await;
        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_validator_runtime_matrix_update() {
        let matrix = AccessControlMatrix::new(); // deny all
        let validator = AccessControlValidator::new(matrix);

        // Initially denied
        let msg = MessageToValidate {
            sender_id: "agent-a".to_string(),
            destination_id: "agent-b".to_string(),
            timestamp: 1700000000000,
        };
        assert!(validator.validate_message(&msg).await.is_denied());

        // Update matrix at runtime (simulates Admin Dashboard push)
        let new_matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("agent-a", "agent-b"),
        ]);
        validator.update_matrix(new_matrix).await;

        // Now allowed without restart
        assert!(validator.validate_message(&msg).await.is_allowed());
    }

    #[tokio::test]
    async fn test_validator_add_rule_runtime() {
        let validator = AccessControlValidator::new(AccessControlMatrix::new());

        let msg = MessageToValidate {
            sender_id: "x".to_string(),
            destination_id: "y".to_string(),
            timestamp: 1700000000000,
        };

        // Initially denied
        assert!(validator.validate_message(&msg).await.is_denied());

        // Add rule at runtime
        validator.add_rule(AccessRule::allow("x", "y")).await;

        // Now allowed
        assert!(validator.validate_message(&msg).await.is_allowed());
    }

    #[tokio::test]
    async fn test_validator_remove_rule_runtime() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("x", "y"),
        ]);
        let validator = AccessControlValidator::new(matrix);

        let msg = MessageToValidate {
            sender_id: "x".to_string(),
            destination_id: "y".to_string(),
            timestamp: 1700000000000,
        };

        // Initially allowed
        assert!(validator.validate_message(&msg).await.is_allowed());

        // Remove rule at runtime
        validator.remove_rule("x", "y").await;

        // Now denied (default deny)
        assert!(validator.validate_message(&msg).await.is_denied());
    }

    #[tokio::test]
    async fn test_validator_update_rule_runtime() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("x", "y"),
        ]);
        let validator = AccessControlValidator::new(matrix);

        let msg = MessageToValidate {
            sender_id: "x".to_string(),
            destination_id: "y".to_string(),
            timestamp: 1700000000000,
        };

        // Initially allowed
        assert!(validator.validate_message(&msg).await.is_allowed());

        // Update to deny at runtime
        validator.update_rule("x", "y", false).await;

        // Now denied
        assert!(validator.validate_message(&msg).await.is_denied());
    }

    #[tokio::test]
    async fn test_validator_get_matrix_snapshot() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("a", "b"),
            AccessRule::deny("c", "d"),
        ]);
        let validator = AccessControlValidator::new(matrix);

        let snapshot = validator.get_matrix_snapshot().await;
        assert_eq!(snapshot.len(), 2);
        assert!(snapshot.is_allowed("a", "b"));
        assert!(!snapshot.is_allowed("c", "d"));
    }

    #[tokio::test]
    async fn test_validator_concurrent_access() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("reader", "target"),
        ]);
        let validator = AccessControlValidator::new(matrix);

        // Spawn multiple concurrent validations
        let mut handles = vec![];
        for i in 0..10 {
            let v = validator.clone();
            let handle = tokio::spawn(async move {
                let msg = MessageToValidate {
                    sender_id: "reader".to_string(),
                    destination_id: "target".to_string(),
                    timestamp: 1700000000000 + i,
                };
                v.validate_message(&msg).await.is_allowed()
            });
            handles.push(handle);
        }

        for handle in handles {
            assert!(handle.await.unwrap());
        }
    }

    // -------------------------------------------------------------------------
    // MatrixStorage mock for testing reload
    // -------------------------------------------------------------------------

    struct MockStorage {
        matrix: AccessControlMatrix,
    }

    #[async_trait::async_trait]
    impl MatrixStorage for MockStorage {
        async fn load_matrix(&self) -> Result<AccessControlMatrix, StorageError> {
            Ok(self.matrix.clone())
        }

        async fn save_matrix(&self, _matrix: &AccessControlMatrix) -> Result<(), StorageError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_validator_reload_from_storage() {
        let validator = AccessControlValidator::new(AccessControlMatrix::new());

        let msg = MessageToValidate {
            sender_id: "stored-agent".to_string(),
            destination_id: "stored-target".to_string(),
            timestamp: 1700000000000,
        };

        // Initially denied
        assert!(validator.validate_message(&msg).await.is_denied());

        // Reload from storage with new rules
        let storage = MockStorage {
            matrix: AccessControlMatrix::from_rules(vec![
                AccessRule::allow("stored-agent", "stored-target"),
            ]),
        };
        validator.reload_from_storage(&storage).await.unwrap();

        // Now allowed
        assert!(validator.validate_message(&msg).await.is_allowed());
    }
}
