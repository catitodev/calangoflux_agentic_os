//! Credential Vault — encrypted secret storage via Google Secret Manager.
//!
//! This module implements the CredentialVault which provides scoped, time-limited
//! access tokens to agents instead of raw secrets. Raw credential values never
//! appear in logs, error messages, or inter-agent communication.
//!
//! Requirements: 2.1, 2.2, 2.3, 2.4

use crate::types::AgentId;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

// =============================================================================
// SecretId Newtype
// =============================================================================

/// Unique identifier for a secret stored in the vault.
/// Wraps a String for type safety, similar to AgentId.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SecretId(pub String);

impl SecretId {
    /// Create a new SecretId from a string-like value.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Returns the inner string reference.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SecretId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<&str> for SecretId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for SecretId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

// =============================================================================
// ScopedToken
// =============================================================================

/// A time-limited, scoped access token returned instead of raw secrets.
/// Maximum TTL is 5 minutes (300 seconds).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopedToken {
    /// The opaque token value (never the raw secret).
    pub token: String,
    /// Unix timestamp (seconds) when this token expires. Max 5 minutes from issuance.
    pub expires_at: u64,
    /// The scopes this token is authorized for.
    pub scope: Vec<String>,
}

impl ScopedToken {
    /// Maximum TTL for a scoped token: 5 minutes (300 seconds).
    pub const MAX_TTL_SECONDS: u64 = 300;

    /// Check if this token has expired based on the current time.
    pub fn is_expired(&self) -> bool {
        let now = current_timestamp_secs();
        now >= self.expires_at
    }

    /// Check if this token has expired based on a given timestamp.
    pub fn is_expired_at(&self, now_secs: u64) -> bool {
        now_secs >= self.expires_at
    }
}

// =============================================================================
// Errors
// =============================================================================

/// Errors that can occur during credential vault operations.
/// Raw secret values are NEVER included in error messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialError {
    /// The requesting agent is not authorized to access this credential.
    Unauthorized {
        agent_id: String,
        secret_id: String,
    },
    /// The secret was not found in the backend.
    NotFound { secret_id: String },
    /// Backend communication failure (details sanitized).
    BackendError { message: String },
}

impl fmt::Display for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CredentialError::Unauthorized {
                agent_id,
                secret_id,
            } => {
                write!(
                    f,
                    "agent '{}' is not authorized to access secret '{}'",
                    agent_id, secret_id
                )
            }
            CredentialError::NotFound { secret_id } => {
                write!(f, "secret '{}' not found", secret_id)
            }
            CredentialError::BackendError { message } => {
                // Never include raw secret data in error messages
                write!(f, "credential backend error: {}", message)
            }
        }
    }
}

impl std::error::Error for CredentialError {}

// =============================================================================
// SecretManagerClient Trait
// =============================================================================

/// Trait abstracting the secret manager backend for mockability in tests.
/// In production, this wraps Google Secret Manager.
#[async_trait]
pub trait SecretManagerClient: Send + Sync {
    /// Retrieve a secret value by its ID.
    /// Returns the raw secret bytes (only used internally, never exposed externally).
    async fn get_secret(&self, secret_id: &SecretId) -> Result<Vec<u8>, CredentialError>;
}

// =============================================================================
// CredentialVault
// =============================================================================

/// Cache entry for a scoped token with its associated metadata.
#[derive(Debug, Clone)]
struct CachedToken {
    token: ScopedToken,
}

/// The Credential Vault manages access to secrets stored in Google Secret Manager.
///
/// Key invariants:
/// - Raw secrets are NEVER returned to callers; only scoped tokens with max 5min TTL.
/// - Raw secrets are NEVER logged or included in error messages.
/// - Only agents that own a credential can request it (ownership map).
/// - Token cache avoids redundant backend calls for active tokens.
pub struct CredentialVault {
    /// The backend secret manager client (Google Secret Manager or mock).
    client: Box<dyn SecretManagerClient>,
    /// Cache of active scoped tokens keyed by (AgentId, SecretId).
    token_cache: HashMap<(AgentId, SecretId), CachedToken>,
    /// Ownership map: which agents own which secrets.
    ownership_map: HashMap<AgentId, Vec<SecretId>>,
}

impl CredentialVault {
    /// Create a new CredentialVault with the given backend client and ownership map.
    pub fn new(
        client: Box<dyn SecretManagerClient>,
        ownership_map: HashMap<AgentId, Vec<SecretId>>,
    ) -> Self {
        Self {
            client,
            token_cache: HashMap::new(),
            ownership_map,
        }
    }

    /// Request a scoped, time-limited access token for a credential.
    ///
    /// This method:
    /// 1. Checks that the agent is authorized to access the secret (ownership).
    /// 2. Returns a cached token if one exists and is still valid.
    /// 3. Otherwise, fetches from the backend and issues a new scoped token.
    ///
    /// Raw secrets are NEVER returned — only opaque scoped tokens with TTL ≤ 300s.
    pub async fn request_credential(
        &mut self,
        agent_id: &AgentId,
        secret_id: &SecretId,
    ) -> Result<ScopedToken, CredentialError> {
        // Step 1: Authorization check
        if !self.check_authorization(agent_id, secret_id) {
            return Err(CredentialError::Unauthorized {
                agent_id: agent_id.as_str().to_string(),
                secret_id: secret_id.as_str().to_string(),
            });
        }

        let now = current_timestamp_secs();

        // Step 2: Check cache for a valid (non-expired) token
        let cache_key = (agent_id.clone(), secret_id.clone());
        if let Some(cached) = self.token_cache.get(&cache_key) {
            if !cached.token.is_expired_at(now) {
                return Ok(cached.token.clone());
            }
            // Token expired — remove from cache and fetch fresh
        }

        // Step 3: Fetch from backend (raw secret used only to derive token)
        let raw_secret = self.client.get_secret(secret_id).await?;

        // Step 4: Generate a scoped token (opaque, not the raw secret)
        let scoped_token = generate_scoped_token(&raw_secret, agent_id, secret_id, now);

        // Step 5: Cache the token
        self.token_cache.insert(
            cache_key,
            CachedToken {
                token: scoped_token.clone(),
            },
        );

        Ok(scoped_token)
    }

    /// Check if an agent is authorized to access a given credential.
    /// Returns true only if the agent owns the credential in the ownership map.
    pub fn check_authorization(&self, agent_id: &AgentId, secret_id: &SecretId) -> bool {
        self.ownership_map
            .get(agent_id)
            .map(|secrets| secrets.contains(secret_id))
            .unwrap_or(false)
    }

    /// Evict expired tokens from the cache.
    /// Call periodically to prevent unbounded cache growth.
    pub fn evict_expired_tokens(&mut self) {
        let now = current_timestamp_secs();
        self.token_cache
            .retain(|_, cached| !cached.token.is_expired_at(now));
    }

    /// Evict expired tokens based on a given timestamp (useful for testing).
    pub fn evict_expired_tokens_at(&mut self, now_secs: u64) {
        self.token_cache
            .retain(|_, cached| !cached.token.is_expired_at(now_secs));
    }

    /// Get the number of cached tokens (for diagnostics).
    pub fn cache_size(&self) -> usize {
        self.token_cache.len()
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Get the current Unix timestamp in seconds.
fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Generate a scoped token from the raw secret.
/// The token is an opaque SHA-256 hash — the raw secret is never exposed.
fn generate_scoped_token(
    raw_secret: &[u8],
    agent_id: &AgentId,
    secret_id: &SecretId,
    now_secs: u64,
) -> ScopedToken {
    use sha2::{Digest, Sha256};

    // Create a deterministic but opaque token by hashing:
    // raw_secret + agent_id + secret_id + timestamp
    let mut hasher = Sha256::new();
    hasher.update(raw_secret);
    hasher.update(agent_id.as_str().as_bytes());
    hasher.update(secret_id.as_str().as_bytes());
    hasher.update(now_secs.to_le_bytes());
    let hash = hasher.finalize();

    let token = hex::encode(hash);
    let expires_at = now_secs + ScopedToken::MAX_TTL_SECONDS;

    ScopedToken {
        token,
        expires_at,
        scope: vec![format!("secret:{}", secret_id.as_str())],
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// Mock implementation of SecretManagerClient for testing.
    struct MockSecretManager {
        secrets: HashMap<String, Vec<u8>>,
        call_count: Arc<Mutex<u32>>,
    }

    impl MockSecretManager {
        fn new(secrets: HashMap<String, Vec<u8>>) -> Self {
            Self {
                secrets,
                call_count: Arc::new(Mutex::new(0)),
            }
        }

        fn call_count(&self) -> Arc<Mutex<u32>> {
            self.call_count.clone()
        }
    }

    #[async_trait]
    impl SecretManagerClient for MockSecretManager {
        async fn get_secret(&self, secret_id: &SecretId) -> Result<Vec<u8>, CredentialError> {
            let mut count = self.call_count.lock().await;
            *count += 1;

            self.secrets
                .get(secret_id.as_str())
                .cloned()
                .ok_or_else(|| CredentialError::NotFound {
                    secret_id: secret_id.as_str().to_string(),
                })
        }
    }

    fn setup_vault() -> (CredentialVault, Arc<Mutex<u32>>) {
        let mut secrets = HashMap::new();
        secrets.insert(
            "api-key-openai".to_string(),
            b"sk-super-secret-key-12345".to_vec(),
        );
        secrets.insert(
            "api-key-stripe".to_string(),
            b"sk_live_stripe_secret".to_vec(),
        );

        let mock = MockSecretManager::new(secrets);
        let call_count = mock.call_count();

        let mut ownership_map: HashMap<AgentId, Vec<SecretId>> = HashMap::new();
        ownership_map.insert(
            AgentId::new("openclaw"),
            vec![
                SecretId::new("api-key-openai"),
                SecretId::new("api-key-stripe"),
            ],
        );
        ownership_map.insert(
            AgentId::new("picoclaw"),
            vec![SecretId::new("api-key-openai")],
        );

        let vault = CredentialVault::new(Box::new(mock), ownership_map);
        (vault, call_count)
    }

    #[tokio::test]
    async fn test_authorized_agent_gets_scoped_token() {
        let (mut vault, _) = setup_vault();
        let agent = AgentId::new("openclaw");
        let secret = SecretId::new("api-key-openai");

        let result = vault.request_credential(&agent, &secret).await;
        assert!(result.is_ok());

        let token = result.unwrap();
        // Token must not be the raw secret
        assert_ne!(token.token, "sk-super-secret-key-12345");
        assert!(!token.token.contains("sk-super-secret"));
        // TTL must be ≤ 300 seconds
        let now = current_timestamp_secs();
        assert!(token.expires_at <= now + ScopedToken::MAX_TTL_SECONDS + 1);
        assert!(token.expires_at > now);
        // Scope must reference the secret
        assert!(token.scope.contains(&"secret:api-key-openai".to_string()));
    }

    #[tokio::test]
    async fn test_unauthorized_agent_denied() {
        let (mut vault, _) = setup_vault();
        let agent = AgentId::new("malicious-agent");
        let secret = SecretId::new("api-key-openai");

        let result = vault.request_credential(&agent, &secret).await;
        assert!(result.is_err());

        match result.unwrap_err() {
            CredentialError::Unauthorized {
                agent_id,
                secret_id,
            } => {
                assert_eq!(agent_id, "malicious-agent");
                assert_eq!(secret_id, "api-key-openai");
            }
            other => panic!("Expected Unauthorized error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_agent_cannot_access_unowned_secret() {
        let (mut vault, _) = setup_vault();
        // picoclaw only owns api-key-openai, not api-key-stripe
        let agent = AgentId::new("picoclaw");
        let secret = SecretId::new("api-key-stripe");

        let result = vault.request_credential(&agent, &secret).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CredentialError::Unauthorized { .. }
        ));
    }

    #[tokio::test]
    async fn test_token_cache_returns_same_token() {
        let (mut vault, call_count) = setup_vault();
        let agent = AgentId::new("openclaw");
        let secret = SecretId::new("api-key-openai");

        let token1 = vault.request_credential(&agent, &secret).await.unwrap();
        let token2 = vault.request_credential(&agent, &secret).await.unwrap();

        // Same token returned from cache
        assert_eq!(token1.token, token2.token);
        assert_eq!(token1.expires_at, token2.expires_at);

        // Backend should only be called once (second call served from cache)
        let count = call_count.lock().await;
        assert_eq!(*count, 1);
    }

    #[tokio::test]
    async fn test_secret_not_found() {
        let (mut vault, _) = setup_vault();
        // Add ownership for a non-existent secret
        vault.ownership_map.insert(
            AgentId::new("test-agent"),
            vec![SecretId::new("non-existent-secret")],
        );

        let agent = AgentId::new("test-agent");
        let secret = SecretId::new("non-existent-secret");

        let result = vault.request_credential(&agent, &secret).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CredentialError::NotFound { .. }
        ));
    }

    #[tokio::test]
    async fn test_token_never_contains_raw_secret() {
        let (mut vault, _) = setup_vault();
        let agent = AgentId::new("openclaw");
        let secret = SecretId::new("api-key-openai");

        let token = vault.request_credential(&agent, &secret).await.unwrap();

        // The raw secret is "sk-super-secret-key-12345"
        // Token must not contain any part of it
        assert!(!token.token.contains("sk-"));
        assert!(!token.token.contains("super-secret"));
        assert!(!token.token.contains("12345"));

        // Token should be a hex-encoded SHA-256 hash (64 chars)
        assert_eq!(token.token.len(), 64);
        assert!(token.token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn test_token_ttl_max_5_minutes() {
        let (mut vault, _) = setup_vault();
        let agent = AgentId::new("openclaw");
        let secret = SecretId::new("api-key-openai");

        let before = current_timestamp_secs();
        let token = vault.request_credential(&agent, &secret).await.unwrap();
        let after = current_timestamp_secs();

        // expires_at should be within [before + 300, after + 300]
        assert!(token.expires_at >= before + ScopedToken::MAX_TTL_SECONDS);
        assert!(token.expires_at <= after + ScopedToken::MAX_TTL_SECONDS);
    }

    #[tokio::test]
    async fn test_check_authorization() {
        let (vault, _) = setup_vault();

        // openclaw owns both secrets
        assert!(vault.check_authorization(
            &AgentId::new("openclaw"),
            &SecretId::new("api-key-openai")
        ));
        assert!(vault.check_authorization(
            &AgentId::new("openclaw"),
            &SecretId::new("api-key-stripe")
        ));

        // picoclaw only owns api-key-openai
        assert!(vault.check_authorization(
            &AgentId::new("picoclaw"),
            &SecretId::new("api-key-openai")
        ));
        assert!(!vault.check_authorization(
            &AgentId::new("picoclaw"),
            &SecretId::new("api-key-stripe")
        ));

        // unknown agent owns nothing
        assert!(!vault.check_authorization(
            &AgentId::new("unknown"),
            &SecretId::new("api-key-openai")
        ));
    }

    #[tokio::test]
    async fn test_evict_expired_tokens() {
        let (mut vault, _) = setup_vault();
        let agent = AgentId::new("openclaw");
        let secret = SecretId::new("api-key-openai");

        // Request a token (gets cached)
        let _token = vault.request_credential(&agent, &secret).await.unwrap();
        assert_eq!(vault.cache_size(), 1);

        // Evict with a future timestamp (token should be expired)
        let far_future = current_timestamp_secs() + 600; // 10 minutes from now
        vault.evict_expired_tokens_at(far_future);
        assert_eq!(vault.cache_size(), 0);
    }

    #[tokio::test]
    async fn test_evict_keeps_valid_tokens() {
        let (mut vault, _) = setup_vault();
        let agent = AgentId::new("openclaw");
        let secret = SecretId::new("api-key-openai");

        // Request a token (gets cached)
        let _token = vault.request_credential(&agent, &secret).await.unwrap();
        assert_eq!(vault.cache_size(), 1);

        // Evict with current timestamp (token should still be valid)
        let now = current_timestamp_secs();
        vault.evict_expired_tokens_at(now);
        assert_eq!(vault.cache_size(), 1);
    }

    #[tokio::test]
    async fn test_error_messages_never_contain_secrets() {
        let (mut vault, _) = setup_vault();

        // Test Unauthorized error — must not contain raw secret values
        let err = vault
            .request_credential(
                &AgentId::new("bad-agent"),
                &SecretId::new("api-key-openai"),
            )
            .await
            .unwrap_err();
        let err_msg = format!("{}", err);
        assert!(!err_msg.contains("sk-super-secret"));
        assert!(!err_msg.contains("12345"));
        assert!(!err_msg.contains("sk_live_stripe"));

        // Test NotFound error — must not contain raw secret values
        vault.ownership_map.insert(
            AgentId::new("test"),
            vec![SecretId::new("missing")],
        );
        let err = vault
            .request_credential(&AgentId::new("test"), &SecretId::new("missing"))
            .await
            .unwrap_err();
        let err_msg = format!("{}", err);
        assert!(!err_msg.contains("sk-super-secret"));
        assert!(!err_msg.contains("sk_live_stripe"));
        // Should contain the secret ID (for debugging), but never the value
        assert!(err_msg.contains("missing"));
    }

    #[test]
    fn test_secret_id_creation() {
        let id = SecretId::new("my-secret");
        assert_eq!(id.as_str(), "my-secret");
        assert_eq!(id.to_string(), "my-secret");
    }

    #[test]
    fn test_secret_id_from_str() {
        let id: SecretId = "test-secret".into();
        assert_eq!(id.as_str(), "test-secret");
    }

    #[test]
    fn test_secret_id_equality() {
        let a = SecretId::new("secret-1");
        let b = SecretId::new("secret-1");
        let c = SecretId::new("secret-2");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn test_scoped_token_expiration() {
        let token = ScopedToken {
            token: "abc123".to_string(),
            expires_at: 1000,
            scope: vec!["read".to_string()],
        };

        assert!(token.is_expired_at(1000)); // at expiry = expired
        assert!(token.is_expired_at(1001)); // past expiry = expired
        assert!(!token.is_expired_at(999)); // before expiry = valid
    }

    #[test]
    fn test_scoped_token_max_ttl() {
        assert_eq!(ScopedToken::MAX_TTL_SECONDS, 300);
    }
}
