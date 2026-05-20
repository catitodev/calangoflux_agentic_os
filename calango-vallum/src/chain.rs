//! CHAIN Agent — immutable audit trail via SHA-256 hash chain.
//!
//! Records every inter-agent message, agent lifecycle event, and security event
//! as an entry in a SHA-256 hash chain. Each entry contains the hash of the
//! previous entry, forming a tamper-evident append-only log.

use sha2::{Digest, Sha256};
use std::fmt;

/// Types of actions that can be recorded in the audit trail.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ActionType {
    MessageSent,
    MessageReceived,
    AgentStarted,
    AgentStopped,
    AgentRestarted,
    SecurityViolation,
    CredentialAccess,
    ConfigChange,
    DeploymentEvent,
}

impl fmt::Display for ActionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ActionType::MessageSent => "MessageSent",
            ActionType::MessageReceived => "MessageReceived",
            ActionType::AgentStarted => "AgentStarted",
            ActionType::AgentStopped => "AgentStopped",
            ActionType::AgentRestarted => "AgentRestarted",
            ActionType::SecurityViolation => "SecurityViolation",
            ActionType::CredentialAccess => "CredentialAccess",
            ActionType::ConfigChange => "ConfigChange",
            ActionType::DeploymentEvent => "DeploymentEvent",
        };
        write!(f, "{}", s)
    }
}

/// A single entry in the immutable audit trail.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    /// UTC timestamp of the event.
    pub timestamp: u64,
    /// The agent or actor that performed the action.
    pub actor: String,
    /// The type of action recorded.
    pub action_type: ActionType,
    /// SHA-256 hash of the action payload.
    pub payload_hash: [u8; 32],
    /// SHA-256 hash of the previous audit entry (zeros for genesis).
    pub previous_hash: [u8; 32],
    /// SHA-256 hash of this entry: hash(timestamp + actor + action_type + payload_hash + previous_hash).
    pub entry_hash: [u8; 32],
}

impl AuditEntry {
    /// Compute the entry hash from the entry's fields.
    /// hash = SHA-256(timestamp || actor || action_type || payload_hash || previous_hash)
    pub fn compute_hash(
        timestamp: u64,
        actor: &str,
        action_type: &ActionType,
        payload_hash: &[u8; 32],
        previous_hash: &[u8; 32],
    ) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(timestamp.to_le_bytes());
        hasher.update(actor.as_bytes());
        hasher.update(action_type.to_string().as_bytes());
        hasher.update(payload_hash);
        hasher.update(previous_hash);
        hasher.finalize().into()
    }

    /// Verify that this entry's hash is correctly computed from its fields.
    pub fn verify(&self) -> bool {
        let computed = Self::compute_hash(
            self.timestamp,
            &self.actor,
            &self.action_type,
            &self.payload_hash,
            &self.previous_hash,
        );
        computed == self.entry_hash
    }
}

/// Errors that can occur during CHAIN Agent operations.
#[derive(Debug, thiserror::Error)]
pub enum ChainError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("integrity violation: {0}")]
    IntegrityViolation(String),
}

/// Trait for audit entry persistence, enabling mockability for testing.
#[async_trait::async_trait]
pub trait AuditStorage: Send + Sync {
    /// Persist a new audit entry to storage.
    async fn persist(&self, entry: &AuditEntry) -> Result<(), ChainError>;

    /// Retrieve the last `count` entries, ordered from oldest to newest.
    async fn get_entries(&self, count: usize) -> Result<Vec<AuditEntry>, ChainError>;

    /// Get the hash of the last persisted entry (zeros if chain is empty).
    async fn get_last_hash(&self) -> Result<[u8; 32], ChainError>;
}

/// The CHAIN Agent maintains an immutable audit trail via SHA-256 hash chain.
pub struct ChainAgent {
    storage: Box<dyn AuditStorage>,
    last_hash: [u8; 32],
}

impl ChainAgent {
    /// Create a new ChainAgent with the given storage backend.
    /// Initializes `last_hash` from the storage.
    pub async fn new(storage: Box<dyn AuditStorage>) -> Result<Self, ChainError> {
        let last_hash = storage.get_last_hash().await?;
        Ok(Self { storage, last_hash })
    }

    /// Record a new audit entry, computing the hash chain link.
    ///
    /// Computes SHA-256(timestamp + actor + action_type + payload_hash + previous_hash),
    /// persists the entry, and updates the internal last_hash.
    pub async fn record(
        &mut self,
        actor: String,
        action_type: ActionType,
        payload: &[u8],
        timestamp: u64,
    ) -> Result<AuditEntry, ChainError> {
        // Compute payload hash
        let payload_hash: [u8; 32] = Sha256::digest(payload).into();

        // Compute entry hash linking to previous
        let entry_hash = AuditEntry::compute_hash(
            timestamp,
            &actor,
            &action_type,
            &payload_hash,
            &self.last_hash,
        );

        let entry = AuditEntry {
            timestamp,
            actor,
            action_type,
            payload_hash,
            previous_hash: self.last_hash,
            entry_hash,
        };

        // Persist to storage
        self.storage.persist(&entry).await?;

        // Update chain head
        self.last_hash = entry_hash;

        Ok(entry)
    }

    /// Verify integrity of the entire hash chain.
    ///
    /// Re-computes all hashes and verifies the chain is unbroken.
    /// Returns `Ok(true)` if the chain is valid, or an error describing the violation.
    pub async fn verify_integrity(&self) -> Result<bool, ChainError> {
        // Retrieve all entries (use a large count to get the full chain)
        let entries = self.storage.get_entries(usize::MAX).await?;

        if entries.is_empty() {
            return Ok(true);
        }

        let mut expected_previous_hash = [0u8; 32];

        for (i, entry) in entries.iter().enumerate() {
            // Verify the previous_hash links correctly
            if entry.previous_hash != expected_previous_hash {
                return Err(ChainError::IntegrityViolation(format!(
                    "entry {} has incorrect previous_hash: chain is broken",
                    i
                )));
            }

            // Verify the entry's own hash is correctly computed
            let computed_hash = AuditEntry::compute_hash(
                entry.timestamp,
                &entry.actor,
                &entry.action_type,
                &entry.payload_hash,
                &entry.previous_hash,
            );

            if computed_hash != entry.entry_hash {
                return Err(ChainError::IntegrityViolation(format!(
                    "entry {} has tampered entry_hash",
                    i
                )));
            }

            expected_previous_hash = entry.entry_hash;
        }

        Ok(true)
    }

    /// Get the last N entries from the audit trail.
    pub async fn get_entries(&self, count: usize) -> Result<Vec<AuditEntry>, ChainError> {
        self.storage.get_entries(count).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// In-memory storage implementation for testing.
    struct InMemoryStorage {
        entries: Arc<Mutex<Vec<AuditEntry>>>,
    }

    impl InMemoryStorage {
        fn new() -> Self {
            Self {
                entries: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    #[async_trait::async_trait]
    impl AuditStorage for InMemoryStorage {
        async fn persist(&self, entry: &AuditEntry) -> Result<(), ChainError> {
            self.entries.lock().unwrap().push(entry.clone());
            Ok(())
        }

        async fn get_entries(&self, count: usize) -> Result<Vec<AuditEntry>, ChainError> {
            let entries = self.entries.lock().unwrap();
            let len = entries.len();
            let start = if len > count { len - count } else { 0 };
            Ok(entries[start..].to_vec())
        }

        async fn get_last_hash(&self) -> Result<[u8; 32], ChainError> {
            let entries = self.entries.lock().unwrap();
            match entries.last() {
                Some(entry) => Ok(entry.entry_hash),
                None => Ok([0u8; 32]),
            }
        }
    }

    #[tokio::test]
    async fn test_genesis_entry_has_zero_previous_hash() {
        let storage = Box::new(InMemoryStorage::new());
        let mut agent = ChainAgent::new(storage).await.unwrap();

        let entry = agent
            .record(
                "agent-1".to_string(),
                ActionType::AgentStarted,
                b"hello world",
                1000,
            )
            .await
            .unwrap();

        assert_eq!(entry.previous_hash, [0u8; 32]);
        assert_ne!(entry.entry_hash, [0u8; 32]);
    }

    #[tokio::test]
    async fn test_hash_chain_links_correctly() {
        let storage = Box::new(InMemoryStorage::new());
        let mut agent = ChainAgent::new(storage).await.unwrap();

        let entry1 = agent
            .record(
                "agent-1".to_string(),
                ActionType::MessageSent,
                b"payload-1",
                1000,
            )
            .await
            .unwrap();

        let entry2 = agent
            .record(
                "agent-2".to_string(),
                ActionType::MessageReceived,
                b"payload-2",
                2000,
            )
            .await
            .unwrap();

        let entry3 = agent
            .record(
                "agent-1".to_string(),
                ActionType::SecurityViolation,
                b"payload-3",
                3000,
            )
            .await
            .unwrap();

        // Verify chain links
        assert_eq!(entry1.previous_hash, [0u8; 32]);
        assert_eq!(entry2.previous_hash, entry1.entry_hash);
        assert_eq!(entry3.previous_hash, entry2.entry_hash);
    }

    #[tokio::test]
    async fn test_entry_hash_is_deterministic() {
        let timestamp = 12345u64;
        let actor = "test-agent";
        let action_type = ActionType::ConfigChange;
        let payload_hash = Sha256::digest(b"test-payload").into();
        let previous_hash = [0u8; 32];

        let hash1 =
            AuditEntry::compute_hash(timestamp, actor, &action_type, &payload_hash, &previous_hash);
        let hash2 =
            AuditEntry::compute_hash(timestamp, actor, &action_type, &payload_hash, &previous_hash);

        assert_eq!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_different_inputs_produce_different_hashes() {
        let payload_hash: [u8; 32] = Sha256::digest(b"payload").into();
        let previous_hash = [0u8; 32];

        let hash1 = AuditEntry::compute_hash(
            1000,
            "agent-1",
            &ActionType::MessageSent,
            &payload_hash,
            &previous_hash,
        );

        let hash2 = AuditEntry::compute_hash(
            2000, // different timestamp
            "agent-1",
            &ActionType::MessageSent,
            &payload_hash,
            &previous_hash,
        );

        let hash3 = AuditEntry::compute_hash(
            1000,
            "agent-2", // different actor
            &ActionType::MessageSent,
            &payload_hash,
            &previous_hash,
        );

        assert_ne!(hash1, hash2);
        assert_ne!(hash1, hash3);
        assert_ne!(hash2, hash3);
    }

    #[tokio::test]
    async fn test_verify_integrity_empty_chain() {
        let storage = Box::new(InMemoryStorage::new());
        let agent = ChainAgent::new(storage).await.unwrap();

        let result = agent.verify_integrity().await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn test_verify_integrity_valid_chain() {
        let storage = Box::new(InMemoryStorage::new());
        let mut agent = ChainAgent::new(storage).await.unwrap();

        agent
            .record(
                "agent-1".to_string(),
                ActionType::AgentStarted,
                b"start",
                1000,
            )
            .await
            .unwrap();

        agent
            .record(
                "agent-1".to_string(),
                ActionType::MessageSent,
                b"hello",
                2000,
            )
            .await
            .unwrap();

        agent
            .record(
                "agent-2".to_string(),
                ActionType::MessageReceived,
                b"hello",
                3000,
            )
            .await
            .unwrap();

        let result = agent.verify_integrity().await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn test_verify_integrity_detects_tampered_entry_hash() {
        let entries = Arc::new(Mutex::new(Vec::new()));
        let storage = Box::new(InMemoryStorage {
            entries: entries.clone(),
        });
        let mut agent = ChainAgent::new(storage).await.unwrap();

        agent
            .record(
                "agent-1".to_string(),
                ActionType::AgentStarted,
                b"start",
                1000,
            )
            .await
            .unwrap();

        agent
            .record(
                "agent-1".to_string(),
                ActionType::MessageSent,
                b"hello",
                2000,
            )
            .await
            .unwrap();

        // Tamper with the second entry's hash
        {
            let mut locked = entries.lock().unwrap();
            locked[1].entry_hash = [0xFFu8; 32];
        }

        let result = agent.verify_integrity().await;
        assert!(result.is_err());
        match result {
            Err(ChainError::IntegrityViolation(msg)) => {
                assert!(msg.contains("tampered"));
            }
            _ => panic!("expected IntegrityViolation error"),
        }
    }

    #[tokio::test]
    async fn test_verify_integrity_detects_broken_chain_link() {
        let entries = Arc::new(Mutex::new(Vec::new()));
        let storage = Box::new(InMemoryStorage {
            entries: entries.clone(),
        });
        let mut agent = ChainAgent::new(storage).await.unwrap();

        agent
            .record(
                "agent-1".to_string(),
                ActionType::AgentStarted,
                b"start",
                1000,
            )
            .await
            .unwrap();

        agent
            .record(
                "agent-1".to_string(),
                ActionType::MessageSent,
                b"hello",
                2000,
            )
            .await
            .unwrap();

        agent
            .record(
                "agent-2".to_string(),
                ActionType::CredentialAccess,
                b"cred",
                3000,
            )
            .await
            .unwrap();

        // Tamper with the second entry's previous_hash (break the chain link)
        {
            let mut locked = entries.lock().unwrap();
            locked[1].previous_hash = [0xAAu8; 32];
        }

        let result = agent.verify_integrity().await;
        assert!(result.is_err());
        match result {
            Err(ChainError::IntegrityViolation(msg)) => {
                assert!(msg.contains("chain is broken"));
            }
            _ => panic!("expected IntegrityViolation error"),
        }
    }

    #[tokio::test]
    async fn test_get_entries_returns_last_n() {
        let storage = Box::new(InMemoryStorage::new());
        let mut agent = ChainAgent::new(storage).await.unwrap();

        for i in 0..5 {
            agent
                .record(
                    format!("agent-{}", i),
                    ActionType::MessageSent,
                    format!("payload-{}", i).as_bytes(),
                    (i as u64) * 1000,
                )
                .await
                .unwrap();
        }

        let last_2 = agent.get_entries(2).await.unwrap();
        assert_eq!(last_2.len(), 2);
        assert_eq!(last_2[0].actor, "agent-3");
        assert_eq!(last_2[1].actor, "agent-4");

        let all = agent.get_entries(100).await.unwrap();
        assert_eq!(all.len(), 5);
    }

    #[tokio::test]
    async fn test_entry_verify_method() {
        let storage = Box::new(InMemoryStorage::new());
        let mut agent = ChainAgent::new(storage).await.unwrap();

        let entry = agent
            .record(
                "agent-1".to_string(),
                ActionType::DeploymentEvent,
                b"deploy-v2",
                5000,
            )
            .await
            .unwrap();

        assert!(entry.verify());

        // Tamper and verify fails
        let mut tampered = entry.clone();
        tampered.timestamp = 9999;
        assert!(!tampered.verify());
    }

    #[tokio::test]
    async fn test_all_action_types_can_be_recorded() {
        let storage = Box::new(InMemoryStorage::new());
        let mut agent = ChainAgent::new(storage).await.unwrap();

        let action_types = vec![
            ActionType::MessageSent,
            ActionType::MessageReceived,
            ActionType::AgentStarted,
            ActionType::AgentStopped,
            ActionType::AgentRestarted,
            ActionType::SecurityViolation,
            ActionType::CredentialAccess,
            ActionType::ConfigChange,
            ActionType::DeploymentEvent,
        ];

        for (i, action) in action_types.into_iter().enumerate() {
            let entry = agent
                .record(
                    "test-agent".to_string(),
                    action.clone(),
                    b"test",
                    i as u64,
                )
                .await
                .unwrap();
            assert!(entry.verify());
            assert_eq!(entry.action_type, action);
        }

        let result = agent.verify_integrity().await.unwrap();
        assert!(result);
    }
}
