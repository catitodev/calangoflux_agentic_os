//! Access Control — inter-agent communication permission matrix.
//!
//! Defines the access control rules that CalangoVallum uses to validate
//! whether a sender agent is permitted to communicate with a destination agent.
//! The matrix is configurable at runtime via the Admin Dashboard (Requirement 16.4).

use serde::{Deserialize, Serialize};

use crate::types::AgentId;

/// A single rule in the access control matrix.
///
/// Defines whether a `source` agent is allowed to send messages to a
/// `destination` agent. CalangoVallum validates every message against
/// the matrix before delivery (Requirement 16.1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessRule {
    /// The agent attempting to send a message.
    pub source: AgentId,
    /// The intended recipient agent.
    pub destination: AgentId,
    /// Whether this communication path is permitted.
    pub allowed: bool,
}

impl AccessRule {
    /// Create a new access rule.
    pub fn new(source: AgentId, destination: AgentId, allowed: bool) -> Self {
        Self {
            source,
            destination,
            allowed,
        }
    }

    /// Create a rule that allows communication between source and destination.
    pub fn allow(source: AgentId, destination: AgentId) -> Self {
        Self::new(source, destination, true)
    }

    /// Create a rule that denies communication between source and destination.
    pub fn deny(source: AgentId, destination: AgentId) -> Self {
        Self::new(source, destination, false)
    }
}

/// The access control matrix holding all rules.
///
/// Used by the Message Bus and CalangoVallum to validate inter-agent
/// communication. Default policy is deny-all (zero-trust).
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

    /// Add a rule to the matrix.
    pub fn add_rule(&mut self, rule: AccessRule) {
        // Replace existing rule for the same source/destination pair
        self.rules
            .retain(|r| !(r.source == rule.source && r.destination == rule.destination));
        self.rules.push(rule);
    }

    /// Remove a rule for a specific source/destination pair.
    pub fn remove_rule(&mut self, source: &AgentId, destination: &AgentId) {
        self.rules
            .retain(|r| !(r.source == *source && r.destination == *destination));
    }

    /// Check if a source agent is allowed to send messages to a destination agent.
    ///
    /// Returns `false` (deny) if no explicit rule exists (zero-trust default).
    pub fn is_allowed(&self, source: &AgentId, destination: &AgentId) -> bool {
        self.rules
            .iter()
            .find(|r| r.source == *source && r.destination == *destination)
            .map(|r| r.allowed)
            .unwrap_or(false) // Default: deny
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
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_access_rule_creation() {
        let rule = AccessRule::new(
            AgentId::new("picoclaw"),
            AgentId::new("openclaw"),
            true,
        );
        assert_eq!(rule.source.as_str(), "picoclaw");
        assert_eq!(rule.destination.as_str(), "openclaw");
        assert!(rule.allowed);
    }

    #[test]
    fn test_access_rule_allow_deny_helpers() {
        let allow = AccessRule::allow(AgentId::new("a"), AgentId::new("b"));
        assert!(allow.allowed);

        let deny = AccessRule::deny(AgentId::new("a"), AgentId::new("b"));
        assert!(!deny.allowed);
    }

    #[test]
    fn test_matrix_default_deny() {
        let matrix = AccessControlMatrix::new();
        let result = matrix.is_allowed(
            &AgentId::new("unknown-agent"),
            &AgentId::new("target"),
        );
        assert!(!result, "Default policy should deny unknown pairs");
    }

    #[test]
    fn test_matrix_explicit_allow() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow(
            AgentId::new("picoclaw"),
            AgentId::new("openclaw"),
        ));

        assert!(matrix.is_allowed(&AgentId::new("picoclaw"), &AgentId::new("openclaw")));
    }

    #[test]
    fn test_matrix_explicit_deny() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::deny(
            AgentId::new("rogue"),
            AgentId::new("vault"),
        ));

        assert!(!matrix.is_allowed(&AgentId::new("rogue"), &AgentId::new("vault")));
    }

    #[test]
    fn test_matrix_rule_replacement() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow(
            AgentId::new("a"),
            AgentId::new("b"),
        ));
        assert!(matrix.is_allowed(&AgentId::new("a"), &AgentId::new("b")));

        // Replace with deny
        matrix.add_rule(AccessRule::deny(
            AgentId::new("a"),
            AgentId::new("b"),
        ));
        assert!(!matrix.is_allowed(&AgentId::new("a"), &AgentId::new("b")));
        assert_eq!(matrix.len(), 1, "Should replace, not duplicate");
    }

    #[test]
    fn test_matrix_remove_rule() {
        let mut matrix = AccessControlMatrix::new();
        matrix.add_rule(AccessRule::allow(
            AgentId::new("a"),
            AgentId::new("b"),
        ));
        assert_eq!(matrix.len(), 1);

        matrix.remove_rule(&AgentId::new("a"), &AgentId::new("b"));
        assert_eq!(matrix.len(), 0);
        // After removal, default deny applies
        assert!(!matrix.is_allowed(&AgentId::new("a"), &AgentId::new("b")));
    }

    #[test]
    fn test_matrix_multiple_rules() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow(AgentId::new("gateway"), AgentId::new("picoclaw")),
            AccessRule::allow(AgentId::new("picoclaw"), AgentId::new("openclaw")),
            AccessRule::allow(AgentId::new("picoclaw"), AgentId::new("gemini")),
            AccessRule::deny(AgentId::new("openclaw"), AgentId::new("vault")),
        ]);

        assert!(matrix.is_allowed(&AgentId::new("gateway"), &AgentId::new("picoclaw")));
        assert!(matrix.is_allowed(&AgentId::new("picoclaw"), &AgentId::new("openclaw")));
        assert!(matrix.is_allowed(&AgentId::new("picoclaw"), &AgentId::new("gemini")));
        assert!(!matrix.is_allowed(&AgentId::new("openclaw"), &AgentId::new("vault")));
        // Not in matrix → deny
        assert!(!matrix.is_allowed(&AgentId::new("openclaw"), &AgentId::new("picoclaw")));
    }

    #[test]
    fn test_matrix_serialization() {
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow(AgentId::new("a"), AgentId::new("b")),
        ]);

        let json = serde_json::to_string(&matrix).unwrap();
        let deserialized: AccessControlMatrix = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.len(), 1);
        assert!(deserialized.is_allowed(&AgentId::new("a"), &AgentId::new("b")));
    }
}
