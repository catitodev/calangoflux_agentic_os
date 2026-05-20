//! Agent Registry — health checks and lifecycle management.
//!
//! Manages agent lifecycle with health monitoring, automatic restart on failure,
//! and kill-switch functionality. Uses traits for sandbox and notification
//! dependencies to enable testing.

use std::collections::HashMap;
use std::time::Duration;

use crate::types::AgentId;

// =============================================================================
// Public Types
// =============================================================================

/// Status of an agent in the registry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentStatus {
    /// Agent is responding to health checks normally.
    Healthy,
    /// Agent has 1-2 consecutive health check failures.
    Degraded,
    /// Agent failed 3 restart attempts and is permanently down.
    Dead,
}

/// Resource usage snapshot for an agent.
#[derive(Clone, Debug, Default)]
pub struct ResourceUsage {
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub uptime_seconds: u64,
}

/// Configuration for provisioning a WASM sandbox.
#[derive(Clone, Debug)]
pub struct SandboxConfig {
    pub max_memory_mb: u32,
    pub max_cpu_millicores: u32,
    pub fuel_limit: u64,
    pub epoch_deadline: u64,
    pub max_host_calls: u32,
}

/// Record for a registered agent including health and resource data.
#[derive(Clone, Debug)]
pub struct AgentRecord {
    pub agent_id: AgentId,
    pub status: AgentStatus,
    pub uptime_seconds: u64,
    pub resource_usage: ResourceUsage,
    pub consecutive_failures: u8,
    pub restart_attempts: u8,
    pub last_health_check: u64,
}

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during registry operations.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("agent not found: {0}")]
    AgentNotFound(AgentId),
    #[error("agent already registered: {0}")]
    AlreadyRegistered(AgentId),
    #[error("sandbox provisioning failed: {0}")]
    SandboxError(String),
    #[error("kill timeout exceeded for agent: {0}")]
    KillTimeout(AgentId),
    #[error("notification failed: {0}")]
    NotificationError(String),
}

// =============================================================================
// Traits for Dependencies (mockable)
// =============================================================================

/// Trait abstracting WASM sandbox operations.
#[async_trait::async_trait]
pub trait SandboxProvider: Send + Sync {
    /// Provision a new sandbox for the given agent with the specified config.
    async fn provision(
        &self,
        agent_id: &AgentId,
        config: &SandboxConfig,
    ) -> Result<(), String>;

    /// Check if the sandbox for the given agent is healthy.
    async fn health_check(&self, agent_id: &AgentId) -> bool;

    /// Terminate the sandbox for the given agent.
    async fn terminate(&self, agent_id: &AgentId) -> Result<(), String>;

    /// Get current resource usage for the agent's sandbox.
    fn resource_usage(&self, agent_id: &AgentId) -> ResourceUsage;
}

/// Trait abstracting notifications to SHIELD and Admin Dashboard.
#[async_trait::async_trait]
pub trait NotificationService: Send + Sync {
    /// Notify SHIELD agent about a dead agent.
    async fn notify_shield(&self, agent_id: &AgentId) -> Result<(), String>;

    /// Alert the Admin Dashboard about a dead agent.
    async fn alert_admin(&self, agent_id: &AgentId) -> Result<(), String>;
}

// =============================================================================
// AgentRegistry
// =============================================================================

/// Central registry managing agent lifecycle, health checks, and kill-switch.
///
/// State machine:
/// - Healthy: 0 consecutive failures
/// - Degraded: 1-2 consecutive failures
/// - Dead: 3 restart failures → notify SHIELD + alert Admin
///
/// On 3 consecutive health check failures: terminate + attempt restart.
/// On 3 restart failures: mark dead.
pub struct AgentRegistry<S: SandboxProvider, N: NotificationService> {
    agents: HashMap<AgentId, AgentRecord>,
    sandbox_provider: S,
    notification_service: N,
    health_check_interval: Duration,
}

impl<S: SandboxProvider, N: NotificationService> AgentRegistry<S, N> {
    /// Create a new AgentRegistry with the given dependencies.
    /// Health check interval defaults to 30 seconds.
    pub fn new(sandbox_provider: S, notification_service: N) -> Self {
        Self {
            agents: HashMap::new(),
            sandbox_provider,
            notification_service,
            health_check_interval: Duration::from_secs(30),
        }
    }

    /// Create a new AgentRegistry with a custom health check interval.
    pub fn with_interval(
        sandbox_provider: S,
        notification_service: N,
        health_check_interval: Duration,
    ) -> Self {
        Self {
            agents: HashMap::new(),
            sandbox_provider,
            notification_service,
            health_check_interval,
        }
    }

    /// Returns the configured health check interval.
    pub fn health_check_interval(&self) -> Duration {
        self.health_check_interval
    }

    /// Register a new agent and provision its WASM sandbox.
    pub async fn register_agent(
        &mut self,
        agent_id: AgentId,
        config: &SandboxConfig,
    ) -> Result<(), RegistryError> {
        if self.agents.contains_key(&agent_id) {
            return Err(RegistryError::AlreadyRegistered(agent_id));
        }

        self.sandbox_provider
            .provision(&agent_id, config)
            .await
            .map_err(RegistryError::SandboxError)?;

        let record = AgentRecord {
            agent_id: agent_id.clone(),
            status: AgentStatus::Healthy,
            uptime_seconds: 0,
            resource_usage: ResourceUsage::default(),
            consecutive_failures: 0,
            restart_attempts: 0,
            last_health_check: current_timestamp(),
        };

        self.agents.insert(agent_id, record);
        Ok(())
    }

    /// Perform a health check on a specific agent.
    ///
    /// Updates the agent's status based on the health check result:
    /// - Success: reset consecutive failures, mark Healthy
    /// - Failure: increment consecutive failures
    ///   - 1-2 failures: mark Degraded
    ///   - 3 failures: terminate + attempt restart
    ///     - Restart success: mark Healthy, reset counters
    ///     - 3 restart failures: mark Dead, notify SHIELD, alert Admin
    pub async fn health_check(&mut self, agent_id: &AgentId) -> Result<AgentStatus, RegistryError> {
        let record = self
            .agents
            .get(agent_id)
            .ok_or_else(|| RegistryError::AgentNotFound(agent_id.clone()))?;

        // Don't health-check dead agents
        if record.status == AgentStatus::Dead {
            return Ok(AgentStatus::Dead);
        }

        let is_healthy = self.sandbox_provider.health_check(agent_id).await;
        let now = current_timestamp();

        // We need to clone the agent_id for later use since we'll borrow mutably
        let agent_id_clone = agent_id.clone();

        let record = self.agents.get_mut(agent_id).unwrap();
        record.last_health_check = now;
        record.resource_usage = self.sandbox_provider.resource_usage(agent_id);

        if is_healthy {
            record.consecutive_failures = 0;
            record.status = AgentStatus::Healthy;
            return Ok(AgentStatus::Healthy);
        }

        // Health check failed
        record.consecutive_failures += 1;

        if record.consecutive_failures < 3 {
            record.status = AgentStatus::Degraded;
            return Ok(AgentStatus::Degraded);
        }

        // 3 consecutive failures: terminate + attempt restart
        let _ = self.sandbox_provider.terminate(&agent_id_clone).await;

        // Reset consecutive failures before attempting restart
        let record = self.agents.get_mut(&agent_id_clone).unwrap();
        record.consecutive_failures = 0;
        record.restart_attempts += 1;

        if record.restart_attempts >= 3 {
            // 3 restart failures: mark dead
            record.status = AgentStatus::Dead;

            // Notify SHIELD and alert Admin (best-effort)
            let _ = self.notification_service.notify_shield(&agent_id_clone).await;
            let _ = self.notification_service.alert_admin(&agent_id_clone).await;

            return Ok(AgentStatus::Dead);
        }

        // Try to restart the sandbox
        let restart_result = self.sandbox_provider.provision(&agent_id_clone, &SandboxConfig {
            max_memory_mb: 128,
            max_cpu_millicores: 500,
            fuel_limit: 1_000_000,
            epoch_deadline: 100,
            max_host_calls: 1000,
        }).await;

        let record = self.agents.get_mut(&agent_id_clone).unwrap();

        match restart_result {
            Ok(()) => {
                record.consecutive_failures = 0;
                record.status = AgentStatus::Healthy;
                Ok(AgentStatus::Healthy)
            }
            Err(_) => {
                // Restart failed, stay degraded until next health check cycle
                record.status = AgentStatus::Degraded;
                Ok(AgentStatus::Degraded)
            }
        }
    }

    /// Terminate an agent within 5 seconds (kill switch).
    ///
    /// Uses tokio timeout to enforce the 5-second deadline.
    pub async fn kill_agent(&mut self, agent_id: &AgentId) -> Result<(), RegistryError> {
        if !self.agents.contains_key(agent_id) {
            return Err(RegistryError::AgentNotFound(agent_id.clone()));
        }

        let kill_result = tokio::time::timeout(
            Duration::from_secs(5),
            self.sandbox_provider.terminate(agent_id),
        )
        .await;

        match kill_result {
            Ok(Ok(())) => {
                self.agents.remove(agent_id);
                Ok(())
            }
            Ok(Err(e)) => {
                // Sandbox reported an error but we still remove from registry
                self.agents.remove(agent_id);
                Err(RegistryError::SandboxError(e))
            }
            Err(_elapsed) => {
                // Timeout exceeded — force remove from registry
                self.agents.remove(agent_id);
                Err(RegistryError::KillTimeout(agent_id.clone()))
            }
        }
    }

    /// List all registered agents with their current status, uptime, and resource usage.
    pub fn list_agents(&self) -> Vec<&AgentRecord> {
        self.agents.values().collect()
    }

    /// Get a specific agent's record.
    pub fn get_agent(&self, agent_id: &AgentId) -> Option<&AgentRecord> {
        self.agents.get(agent_id)
    }

    /// Returns the number of registered agents.
    pub fn agent_count(&self) -> usize {
        self.agents.len()
    }
}

// =============================================================================
// Helpers
// =============================================================================

/// Returns the current Unix timestamp in seconds.
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
    use std::sync::Arc;

    // =========================================================================
    // Mock implementations
    // =========================================================================

    /// Mock sandbox provider for testing.
    struct MockSandbox {
        /// Controls whether health_check returns true or false.
        healthy: Arc<AtomicBool>,
        /// Controls whether provision succeeds or fails.
        provision_succeeds: Arc<AtomicBool>,
        /// Tracks how many times terminate was called.
        terminate_count: Arc<AtomicU8>,
    }

    impl MockSandbox {
        fn new() -> Self {
            Self {
                healthy: Arc::new(AtomicBool::new(true)),
                provision_succeeds: Arc::new(AtomicBool::new(true)),
                terminate_count: Arc::new(AtomicU8::new(0)),
            }
        }

        fn set_healthy(&self, healthy: bool) {
            self.healthy.store(healthy, Ordering::SeqCst);
        }

        fn set_provision_succeeds(&self, succeeds: bool) {
            self.provision_succeeds.store(succeeds, Ordering::SeqCst);
        }

        fn terminate_count(&self) -> u8 {
            self.terminate_count.load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl SandboxProvider for MockSandbox {
        async fn provision(
            &self,
            _agent_id: &AgentId,
            _config: &SandboxConfig,
        ) -> Result<(), String> {
            if self.provision_succeeds.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err("provision failed".to_string())
            }
        }

        async fn health_check(&self, _agent_id: &AgentId) -> bool {
            self.healthy.load(Ordering::SeqCst)
        }

        async fn terminate(&self, _agent_id: &AgentId) -> Result<(), String> {
            self.terminate_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn resource_usage(&self, _agent_id: &AgentId) -> ResourceUsage {
            ResourceUsage {
                cpu_percent: 25.0,
                memory_bytes: 64 * 1024 * 1024,
                uptime_seconds: 120,
            }
        }
    }

    /// Mock notification service for testing.
    struct MockNotifier {
        shield_notified: Arc<AtomicBool>,
        admin_alerted: Arc<AtomicBool>,
    }

    impl MockNotifier {
        fn new() -> Self {
            Self {
                shield_notified: Arc::new(AtomicBool::new(false)),
                admin_alerted: Arc::new(AtomicBool::new(false)),
            }
        }

        fn was_shield_notified(&self) -> bool {
            self.shield_notified.load(Ordering::SeqCst)
        }

        fn was_admin_alerted(&self) -> bool {
            self.admin_alerted.load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl NotificationService for MockNotifier {
        async fn notify_shield(&self, _agent_id: &AgentId) -> Result<(), String> {
            self.shield_notified.store(true, Ordering::SeqCst);
            Ok(())
        }

        async fn alert_admin(&self, _agent_id: &AgentId) -> Result<(), String> {
            self.admin_alerted.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn test_config() -> SandboxConfig {
        SandboxConfig {
            max_memory_mb: 128,
            max_cpu_millicores: 500,
            fuel_limit: 1_000_000,
            epoch_deadline: 100,
            max_host_calls: 1000,
        }
    }

    // =========================================================================
    // Registration tests
    // =========================================================================

    #[tokio::test]
    async fn test_register_agent_success() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        let result = registry.register_agent(agent_id.clone(), &test_config()).await;

        assert!(result.is_ok());
        assert_eq!(registry.agent_count(), 1);

        let record = registry.get_agent(&agent_id).unwrap();
        assert_eq!(record.status, AgentStatus::Healthy);
        assert_eq!(record.consecutive_failures, 0);
        assert_eq!(record.restart_attempts, 0);
    }

    #[tokio::test]
    async fn test_register_duplicate_agent_fails() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        let result = registry.register_agent(agent_id, &test_config()).await;
        assert!(matches!(result, Err(RegistryError::AlreadyRegistered(_))));
    }

    #[tokio::test]
    async fn test_register_agent_sandbox_failure() {
        let sandbox = MockSandbox::new();
        sandbox.set_provision_succeeds(false);
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        let result = registry.register_agent(agent_id, &test_config()).await;

        assert!(matches!(result, Err(RegistryError::SandboxError(_))));
        assert_eq!(registry.agent_count(), 0);
    }

    // =========================================================================
    // Health check tests
    // =========================================================================

    #[tokio::test]
    async fn test_health_check_healthy_agent() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Healthy);
    }

    #[tokio::test]
    async fn test_health_check_single_failure_degrades() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        // Make health check fail
        registry.sandbox_provider.set_healthy(false);

        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Degraded);

        let record = registry.get_agent(&agent_id).unwrap();
        assert_eq!(record.consecutive_failures, 1);
    }

    #[tokio::test]
    async fn test_health_check_two_failures_stays_degraded() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        registry.sandbox_provider.set_healthy(false);

        registry.health_check(&agent_id).await.unwrap();
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Degraded);

        let record = registry.get_agent(&agent_id).unwrap();
        assert_eq!(record.consecutive_failures, 2);
    }

    #[tokio::test]
    async fn test_three_failures_triggers_restart() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        // Fail health checks but allow restart to succeed
        registry.sandbox_provider.set_healthy(false);

        // First two failures → Degraded
        registry.health_check(&agent_id).await.unwrap();
        registry.health_check(&agent_id).await.unwrap();

        // Third failure → terminate + restart (succeeds)
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Healthy);

        // Terminate was called
        assert!(registry.sandbox_provider.terminate_count() >= 1);

        let record = registry.get_agent(&agent_id).unwrap();
        assert_eq!(record.restart_attempts, 1);
        assert_eq!(record.consecutive_failures, 0);
    }

    #[tokio::test]
    async fn test_three_restart_failures_marks_dead() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        // Fail health checks AND restarts
        registry.sandbox_provider.set_healthy(false);
        registry.sandbox_provider.set_provision_succeeds(false);

        // Cycle 1: 3 failures → terminate + restart fails → Degraded, restart_attempts=1
        registry.health_check(&agent_id).await.unwrap();
        registry.health_check(&agent_id).await.unwrap();
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Degraded);

        // Cycle 2: 3 more failures → terminate + restart fails → Degraded, restart_attempts=2
        registry.health_check(&agent_id).await.unwrap();
        registry.health_check(&agent_id).await.unwrap();
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Degraded);

        // Cycle 3: 3 more failures → terminate + restart_attempts=3 → Dead
        registry.health_check(&agent_id).await.unwrap();
        registry.health_check(&agent_id).await.unwrap();
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Dead);

        // Verify notifications were sent
        assert!(registry.notification_service.was_shield_notified());
        assert!(registry.notification_service.was_admin_alerted());
    }

    #[tokio::test]
    async fn test_dead_agent_not_health_checked() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        // Force agent to Dead state
        registry.sandbox_provider.set_healthy(false);
        registry.sandbox_provider.set_provision_succeeds(false);

        // Run through 3 full cycles to reach Dead
        for _ in 0..9 {
            registry.health_check(&agent_id).await.unwrap();
        }

        let record = registry.get_agent(&agent_id).unwrap();
        assert_eq!(record.status, AgentStatus::Dead);

        // Further health checks should just return Dead
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Dead);
    }

    #[tokio::test]
    async fn test_recovery_after_degraded() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        // Fail once → Degraded
        registry.sandbox_provider.set_healthy(false);
        registry.health_check(&agent_id).await.unwrap();
        assert_eq!(registry.get_agent(&agent_id).unwrap().status, AgentStatus::Degraded);

        // Recover → Healthy
        registry.sandbox_provider.set_healthy(true);
        let status = registry.health_check(&agent_id).await.unwrap();
        assert_eq!(status, AgentStatus::Healthy);
        assert_eq!(registry.get_agent(&agent_id).unwrap().consecutive_failures, 0);
    }

    // =========================================================================
    // Kill agent tests
    // =========================================================================

    #[tokio::test]
    async fn test_kill_agent_success() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("agent-1");
        registry.register_agent(agent_id.clone(), &test_config()).await.unwrap();

        let result = registry.kill_agent(&agent_id).await;
        assert!(result.is_ok());
        assert_eq!(registry.agent_count(), 0);
        assert!(registry.get_agent(&agent_id).is_none());
    }

    #[tokio::test]
    async fn test_kill_nonexistent_agent_fails() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        let agent_id = AgentId::new("ghost");
        let result = registry.kill_agent(&agent_id).await;
        assert!(matches!(result, Err(RegistryError::AgentNotFound(_))));
    }

    // =========================================================================
    // List agents tests
    // =========================================================================

    #[tokio::test]
    async fn test_list_agents_empty() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let registry = AgentRegistry::new(sandbox, notifier);

        assert!(registry.list_agents().is_empty());
    }

    #[tokio::test]
    async fn test_list_agents_multiple() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let mut registry = AgentRegistry::new(sandbox, notifier);

        registry.register_agent(AgentId::new("agent-1"), &test_config()).await.unwrap();
        registry.register_agent(AgentId::new("agent-2"), &test_config()).await.unwrap();
        registry.register_agent(AgentId::new("agent-3"), &test_config()).await.unwrap();

        let agents = registry.list_agents();
        assert_eq!(agents.len(), 3);
    }

    // =========================================================================
    // Interval configuration test
    // =========================================================================

    #[test]
    fn test_default_health_check_interval() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let registry = AgentRegistry::new(sandbox, notifier);

        assert_eq!(registry.health_check_interval(), Duration::from_secs(30));
    }

    #[test]
    fn test_custom_health_check_interval() {
        let sandbox = MockSandbox::new();
        let notifier = MockNotifier::new();
        let registry = AgentRegistry::with_interval(
            sandbox,
            notifier,
            Duration::from_secs(60),
        );

        assert_eq!(registry.health_check_interval(), Duration::from_secs(60));
    }
}
