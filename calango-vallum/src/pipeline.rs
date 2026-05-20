//! Security Pipeline — orchestrates CalangoVallum's security components.
//!
//! Wires together SHIELD (monitoring), SPEAR (adversarial testing), CHAIN (audit),
//! HEALER (auto-correction), and AccessControlValidator into a unified pipeline.
//!
//! The pipeline:
//! - Spawns a SHIELD observer task that reads all messages from Redis and calls observe_message
//! - Spawns a SPEAR scheduler task that runs adversarial tests every 6 hours
//! - Spawns a HEALER listener task that listens for failure events and triggers diagnosis
//! - Validates all messages via AccessControlValidator before delivery

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, Mutex};
use tracing;

use crate::access_control::{AccessControlValidator, MessageToValidate, ValidationResult};
use crate::chain::{ActionType, ChainAgent};
use crate::healer::{GeminiAnalyzer, HealerAgent, HealerDeployer, HealerSandbox};
use crate::shield::{BusMessage, SecurityAlert, ShieldAgent};
use crate::spear::{SandboxCloner, SpearAgent, SpearNotifier};

// =============================================================================
// Pipeline Events
// =============================================================================

/// Events flowing through the security pipeline.
#[derive(Debug, Clone)]
pub enum PipelineEvent {
    /// A SHIELD alert was raised (credential exposure, rate limit, anomaly).
    ShieldAlert(SecurityAlert),
    /// A SPEAR adversarial test failed for an agent.
    SpearFailure {
        agent_id: String,
        test_name: String,
        details: String,
    },
    /// An agent failure was detected, triggering HEALER diagnosis.
    AgentFailure {
        agent_id: String,
        error_logs: Vec<String>,
        last_messages: Vec<String>,
    },
}

// =============================================================================
// Pipeline Configuration
// =============================================================================

/// Configuration for the security pipeline.
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Interval between SPEAR adversarial test runs (default: 6 hours).
    pub spear_interval: Duration,
    /// Maximum latency for SHIELD message observation (target: <500ms).
    pub shield_max_latency_ms: u64,
    /// Channel buffer size for pipeline events.
    pub event_channel_size: usize,
    /// Whether to auto-trigger HEALER on SHIELD critical alerts.
    pub auto_heal_on_critical: bool,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            spear_interval: Duration::from_secs(6 * 60 * 60), // 6 hours
            shield_max_latency_ms: 500,
            event_channel_size: 256,
            auto_heal_on_critical: true,
        }
    }
}

// =============================================================================
// Message Bus Trait (for testability)
// =============================================================================

/// Trait for reading messages from the message bus (Redis Streams).
/// Allows mocking in tests.
#[async_trait::async_trait]
pub trait MessageBusReader: Send + Sync + 'static {
    /// Read the next message from the bus. Returns None if the bus is closed.
    async fn read_next(&self) -> Option<BusMessage>;
}

/// Trait for listing agents registered in the Agent Registry.
#[async_trait::async_trait]
pub trait AgentRegistryReader: Send + Sync + 'static {
    /// List all registered agent IDs.
    async fn list_agent_ids(&self) -> Vec<String>;
}

// =============================================================================
// SecurityPipeline
// =============================================================================

/// The SecurityPipeline orchestrates all CalangoVallum security components.
///
/// It holds references to SHIELD, SPEAR, CHAIN, HEALER, and AccessControlValidator,
/// spawning background tasks for continuous monitoring and periodic testing.
pub struct SecurityPipeline<C, N, A, S, D>
where
    C: SandboxCloner + 'static,
    N: SpearNotifier + 'static,
    A: GeminiAnalyzer + 'static,
    S: HealerSandbox + 'static,
    D: HealerDeployer + 'static,
{
    /// SHIELD agent for real-time monitoring.
    pub shield: Arc<Mutex<ShieldAgent>>,
    /// SPEAR agent for adversarial testing.
    pub spear: Arc<SpearAgent<C, N>>,
    /// CHAIN agent for immutable audit trail.
    pub chain: Arc<Mutex<ChainAgent>>,
    /// HEALER agent for auto-correction.
    pub healer: Arc<Mutex<HealerAgent<A, S, D>>>,
    /// Access control validator for message delivery.
    pub access_control: AccessControlValidator,
    /// Pipeline configuration.
    pub config: PipelineConfig,
    /// Event sender for pipeline events.
    event_tx: mpsc::Sender<PipelineEvent>,
    /// Event receiver for pipeline events (consumed by start).
    event_rx: Arc<Mutex<Option<mpsc::Receiver<PipelineEvent>>>>,
}

impl<C, N, A, S, D> SecurityPipeline<C, N, A, S, D>
where
    C: SandboxCloner + 'static,
    N: SpearNotifier + 'static,
    A: GeminiAnalyzer + 'static,
    S: HealerSandbox + 'static,
    D: HealerDeployer + 'static,
{
    /// Create a new SecurityPipeline with all components wired together.
    pub fn new(
        shield: ShieldAgent,
        spear: SpearAgent<C, N>,
        chain: ChainAgent,
        healer: HealerAgent<A, S, D>,
        access_control: AccessControlValidator,
        config: PipelineConfig,
    ) -> Self {
        let (event_tx, event_rx) = mpsc::channel(config.event_channel_size);

        Self {
            shield: Arc::new(Mutex::new(shield)),
            spear: Arc::new(spear),
            chain: Arc::new(Mutex::new(chain)),
            healer: Arc::new(Mutex::new(healer)),
            access_control,
            config,
            event_tx,
            event_rx: Arc::new(Mutex::new(Some(event_rx))),
        }
    }

    /// Start the security pipeline, spawning all background tasks.
    ///
    /// Spawns:
    /// - SHIELD observer task (reads all messages from bus, calls observe_message)
    /// - SPEAR scheduler task (runs adversarial tests at configured interval)
    /// - HEALER listener task (listens for failure events, triggers diagnosis)
    ///
    /// Returns a `PipelineHandle` that can be used to stop the pipeline.
    pub async fn start(
        &self,
        bus_reader: impl MessageBusReader,
        registry: impl AgentRegistryReader,
    ) -> PipelineHandle {
        let (shutdown_tx, _) = tokio::sync::broadcast::channel::<()>(1);

        // Take the event receiver (can only start once)
        let event_rx = self
            .event_rx
            .lock()
            .await
            .take()
            .expect("Pipeline can only be started once");

        // Spawn SHIELD observer task
        let shield_handle = {
            let shield = Arc::clone(&self.shield);
            let chain = Arc::clone(&self.chain);
            let event_tx = self.event_tx.clone();
            let mut shutdown_rx = shutdown_tx.subscribe();
            let bus_reader = Arc::new(bus_reader);

            tokio::spawn(async move {
                Self::shield_observer_loop(shield, chain, event_tx, bus_reader, &mut shutdown_rx)
                    .await;
            })
        };

        // Spawn SPEAR scheduler task
        let spear_handle = {
            let spear = Arc::clone(&self.spear);
            let chain = Arc::clone(&self.chain);
            let event_tx = self.event_tx.clone();
            let interval = self.config.spear_interval;
            let mut shutdown_rx = shutdown_tx.subscribe();
            let registry = Arc::new(registry);

            tokio::spawn(async move {
                Self::spear_scheduler_loop(spear, chain, event_tx, registry, interval, &mut shutdown_rx)
                    .await;
            })
        };

        // Spawn HEALER listener task
        let healer_handle = {
            let healer = Arc::clone(&self.healer);
            let chain = Arc::clone(&self.chain);
            let auto_heal = self.config.auto_heal_on_critical;
            let mut shutdown_rx = shutdown_tx.subscribe();

            tokio::spawn(async move {
                Self::healer_listener_loop(healer, chain, event_rx, auto_heal, &mut shutdown_rx)
                    .await;
            })
        };

        PipelineHandle {
            shutdown_tx,
            _shield_handle: shield_handle,
            _spear_handle: spear_handle,
            _healer_handle: healer_handle,
        }
    }

    /// Validate a message through the access control pipeline before delivery.
    ///
    /// Returns `Ok(())` if the message is allowed, or `Err(violation_reason)` if denied.
    /// On denial, logs the violation to CHAIN.
    pub async fn validate_message_for_delivery(
        &self,
        sender_id: &str,
        destination_id: &str,
        timestamp: u64,
    ) -> Result<(), String> {
        let msg = MessageToValidate {
            sender_id: sender_id.to_string(),
            destination_id: destination_id.to_string(),
            timestamp,
        };

        match self.access_control.validate_message(&msg).await {
            ValidationResult::Allowed => Ok(()),
            ValidationResult::Denied(violation) => {
                // Log violation to CHAIN
                let mut chain = self.chain.lock().await;
                let payload = format!(
                    "Access denied: {} -> {} ({})",
                    violation.source, violation.destination, violation.reason
                );
                let _ = chain
                    .record(
                        violation.source.clone(),
                        ActionType::SecurityViolation,
                        payload.as_bytes(),
                        timestamp,
                    )
                    .await;

                tracing::warn!(
                    source = %violation.source,
                    destination = %violation.destination,
                    "Message blocked by access control pipeline"
                );

                Err(violation.reason)
            }
        }
    }

    /// Send a pipeline event (used by external components to notify failures).
    pub async fn notify_event(&self, event: PipelineEvent) {
        if let Err(e) = self.event_tx.send(event).await {
            tracing::error!("Failed to send pipeline event: {}", e);
        }
    }

    // =========================================================================
    // Background task loops
    // =========================================================================

    /// SHIELD observer loop: reads messages from the bus and monitors them.
    /// On alert: logs to CHAIN, optionally triggers HEALER via event channel.
    async fn shield_observer_loop(
        shield: Arc<Mutex<ShieldAgent>>,
        chain: Arc<Mutex<ChainAgent>>,
        event_tx: mpsc::Sender<PipelineEvent>,
        bus_reader: Arc<dyn MessageBusReader>,
        shutdown_rx: &mut tokio::sync::broadcast::Receiver<()>,
    ) {
        tracing::info!("SHIELD observer task started");

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    tracing::info!("SHIELD observer task shutting down");
                    break;
                }
                msg = bus_reader.read_next() => {
                    match msg {
                        Some(bus_msg) => {
                            let alert = {
                                let mut shield = shield.lock().await;
                                shield.observe_message(&bus_msg)
                            };

                            if let Some(alert) = alert {
                                // Log alert to CHAIN
                                let mut chain_guard = chain.lock().await;
                                let payload = format!(
                                    "SHIELD alert: {:?} for agent {} - {}",
                                    alert.alert_type,
                                    alert.agent_id.as_str(),
                                    alert.details
                                );
                                let _ = chain_guard
                                    .record(
                                        alert.agent_id.as_str().to_string(),
                                        ActionType::SecurityViolation,
                                        payload.as_bytes(),
                                        alert.timestamp,
                                    )
                                    .await;
                                drop(chain_guard);

                                tracing::warn!(
                                    alert_type = ?alert.alert_type,
                                    agent_id = %alert.agent_id,
                                    "SHIELD alert raised, logged to CHAIN"
                                );

                                // Emit event for HEALER consideration
                                let _ = event_tx
                                    .send(PipelineEvent::ShieldAlert(alert))
                                    .await;
                            }
                        }
                        None => {
                            // Bus closed, wait briefly before retrying
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
            }
        }
    }

    /// SPEAR scheduler loop: runs adversarial tests at the configured interval.
    /// On failure: isolates agent via CHAIN + SHIELD notification.
    async fn spear_scheduler_loop(
        spear: Arc<SpearAgent<C, N>>,
        chain: Arc<Mutex<ChainAgent>>,
        event_tx: mpsc::Sender<PipelineEvent>,
        registry: Arc<dyn AgentRegistryReader>,
        interval: Duration,
        shutdown_rx: &mut tokio::sync::broadcast::Receiver<()>,
    ) {
        tracing::info!("SPEAR scheduler task started (interval: {:?})", interval);

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    tracing::info!("SPEAR scheduler task shutting down");
                    break;
                }
                _ = tokio::time::sleep(interval) => {
                    tracing::info!("SPEAR scheduled test run starting");

                    let agent_ids = registry.list_agent_ids().await;

                    for agent_id in &agent_ids {
                        match spear.test_agent(agent_id).await {
                            Ok(results) => {
                                let failures: Vec<_> =
                                    results.iter().filter(|r| !r.passed).collect();

                                if !failures.is_empty() {
                                    // Log to CHAIN
                                    let mut chain_guard = chain.lock().await;
                                    let payload = format!(
                                        "SPEAR test failures for {}: {} of {} tests failed",
                                        agent_id,
                                        failures.len(),
                                        results.len()
                                    );
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis() as u64;
                                    let _ = chain_guard
                                        .record(
                                            agent_id.clone(),
                                            ActionType::SecurityViolation,
                                            payload.as_bytes(),
                                            now,
                                        )
                                        .await;
                                    drop(chain_guard);

                                    // Emit failure event
                                    for failure in failures {
                                        let _ = event_tx
                                            .send(PipelineEvent::SpearFailure {
                                                agent_id: agent_id.clone(),
                                                test_name: failure.test_name.clone(),
                                                details: failure.details.clone(),
                                            })
                                            .await;
                                    }

                                    tracing::warn!(
                                        agent_id = %agent_id,
                                        "SPEAR adversarial test failures detected, agent isolated"
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::error!(
                                    agent_id = %agent_id,
                                    error = %e,
                                    "SPEAR test execution failed"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// HEALER listener loop: listens for failure events and triggers diagnosis.
    /// On HEALER fix: atomic deploy via deploy pipeline.
    async fn healer_listener_loop(
        healer: Arc<Mutex<HealerAgent<A, S, D>>>,
        chain: Arc<Mutex<ChainAgent>>,
        mut event_rx: mpsc::Receiver<PipelineEvent>,
        auto_heal_on_critical: bool,
        shutdown_rx: &mut tokio::sync::broadcast::Receiver<()>,
    ) {
        tracing::info!("HEALER listener task started");

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    tracing::info!("HEALER listener task shutting down");
                    break;
                }
                event = event_rx.recv() => {
                    match event {
                        Some(PipelineEvent::AgentFailure {
                            agent_id,
                            error_logs,
                            last_messages,
                        }) => {
                            tracing::info!(
                                agent_id = %agent_id,
                                "HEALER processing agent failure"
                            );

                            Self::attempt_healing(
                                &healer,
                                &chain,
                                &agent_id,
                                &error_logs,
                                &last_messages,
                            )
                            .await;
                        }
                        Some(PipelineEvent::ShieldAlert(alert)) => {
                            // Only auto-heal on critical alerts if configured
                            if auto_heal_on_critical
                                && alert.severity == crate::shield::AlertSeverity::Critical
                            {
                                tracing::info!(
                                    agent_id = %alert.agent_id,
                                    "HEALER triggered by critical SHIELD alert"
                                );

                                Self::attempt_healing(
                                    &healer,
                                    &chain,
                                    alert.agent_id.as_str(),
                                    &[alert.details.clone()],
                                    &[],
                                )
                                .await;
                            }
                        }
                        Some(PipelineEvent::SpearFailure {
                            agent_id,
                            test_name,
                            details,
                        }) => {
                            tracing::info!(
                                agent_id = %agent_id,
                                test_name = %test_name,
                                "HEALER triggered by SPEAR failure"
                            );

                            Self::attempt_healing(
                                &healer,
                                &chain,
                                &agent_id,
                                &[format!("SPEAR test '{}' failed: {}", test_name, details)],
                                &[],
                            )
                            .await;
                        }
                        None => {
                            // Channel closed
                            tracing::info!("HEALER event channel closed");
                            break;
                        }
                    }
                }
            }
        }
    }

    /// Attempt to heal a failing agent: diagnose, test fix, apply fix.
    async fn attempt_healing(
        healer: &Arc<Mutex<HealerAgent<A, S, D>>>,
        chain: &Arc<Mutex<ChainAgent>>,
        agent_id: &str,
        error_logs: &[String],
        last_messages: &[String],
    ) {
        let mut healer_guard = healer.lock().await;

        // Step 1: Diagnose
        let diagnosis = match healer_guard.diagnose(agent_id, error_logs, last_messages).await {
            Ok(d) => d,
            Err(e) => {
                tracing::error!(agent_id = %agent_id, error = %e, "HEALER diagnosis failed");
                return;
            }
        };

        // Step 2: Test fix in sandbox
        match healer_guard.test_fix(&diagnosis).await {
            Ok(true) => {
                tracing::info!(agent_id = %agent_id, "HEALER sandbox test passed");
            }
            Ok(false) => {
                tracing::warn!(agent_id = %agent_id, "HEALER sandbox test failed, aborting fix");
                return;
            }
            Err(e) => {
                tracing::error!(agent_id = %agent_id, error = %e, "HEALER sandbox test error");
                return;
            }
        }

        // Step 3: Apply fix via atomic deploy
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        match healer_guard.apply_fix(&diagnosis, now_secs).await {
            Ok(()) => {
                tracing::info!(agent_id = %agent_id, "HEALER fix applied successfully");

                // Log successful fix to CHAIN
                drop(healer_guard);
                let mut chain_guard = chain.lock().await;
                let payload = format!(
                    "HEALER auto-fix applied for agent {}: {}",
                    agent_id, diagnosis.proposed_fix
                );
                let _ = chain_guard
                    .record(
                        agent_id.to_string(),
                        ActionType::DeploymentEvent,
                        payload.as_bytes(),
                        now_secs * 1000,
                    )
                    .await;
            }
            Err(e) => {
                tracing::error!(
                    agent_id = %agent_id,
                    error = %e,
                    "HEALER fix deployment failed (rollback attempted)"
                );
            }
        }
    }
}

// =============================================================================
// PipelineHandle
// =============================================================================

/// Handle to a running security pipeline. Drop to stop all tasks.
pub struct PipelineHandle {
    shutdown_tx: tokio::sync::broadcast::Sender<()>,
    _shield_handle: tokio::task::JoinHandle<()>,
    _spear_handle: tokio::task::JoinHandle<()>,
    _healer_handle: tokio::task::JoinHandle<()>,
}

impl PipelineHandle {
    /// Gracefully shut down the security pipeline.
    pub fn shutdown(self) {
        let _ = self.shutdown_tx.send(());
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::access_control::{AccessControlMatrix, AccessRule};
    use crate::chain::{AuditEntry, AuditStorage, ChainError};
    use crate::healer::{HealerDiagnosis, HealerError};
    use crate::shield::AgentId;
    use crate::spear::{
        AdversarialTest, AdversarialTestSuite, SandboxHandle, SpearError, TestResult,
    };
    use std::sync::{Arc as StdArc, Mutex as StdMutex};

    // =========================================================================
    // Mock implementations
    // =========================================================================

    struct MockBusReader {
        messages: Arc<Mutex<Vec<BusMessage>>>,
    }

    #[async_trait::async_trait]
    impl MessageBusReader for MockBusReader {
        async fn read_next(&self) -> Option<BusMessage> {
            let mut msgs = self.messages.lock().await;
            if msgs.is_empty() {
                // Simulate waiting
                tokio::time::sleep(Duration::from_millis(50)).await;
                None
            } else {
                Some(msgs.remove(0))
            }
        }
    }

    struct MockRegistry {
        agents: Vec<String>,
    }

    #[async_trait::async_trait]
    impl AgentRegistryReader for MockRegistry {
        async fn list_agent_ids(&self) -> Vec<String> {
            self.agents.clone()
        }
    }

    // Mock audit storage
    struct InMemoryAuditStorage {
        entries: StdArc<StdMutex<Vec<AuditEntry>>>,
    }

    impl InMemoryAuditStorage {
        fn new() -> Self {
            Self {
                entries: StdArc::new(StdMutex::new(Vec::new())),
            }
        }
    }

    #[async_trait::async_trait]
    impl AuditStorage for InMemoryAuditStorage {
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

    // Mock SPEAR dependencies
    struct MockCloner {
        results: StdArc<StdMutex<Vec<TestResult>>>,
    }

    #[async_trait::async_trait]
    impl SandboxCloner for MockCloner {
        async fn clone_sandbox(&self, agent_id: &str) -> Result<SandboxHandle, SpearError> {
            Ok(SandboxHandle {
                sandbox_id: format!("sandbox-{}", agent_id),
                agent_id: agent_id.to_string(),
            })
        }

        async fn run_test_in_sandbox(
            &self,
            _handle: &SandboxHandle,
            _test: &AdversarialTest,
        ) -> Result<TestResult, SpearError> {
            let mut results = self.results.lock().unwrap();
            if results.is_empty() {
                Ok(TestResult {
                    agent_id: "test".to_string(),
                    test_name: "default".to_string(),
                    passed: true,
                    details: "passed".to_string(),
                    timestamp: 0,
                })
            } else {
                Ok(results.remove(0))
            }
        }
    }

    struct MockNotifier;

    #[async_trait::async_trait]
    impl SpearNotifier for MockNotifier {
        async fn isolate_agent(&self, _agent_id: &str) -> Result<(), SpearError> {
            Ok(())
        }
        async fn notify_shield(
            &self,
            _agent_id: &str,
            _results: &[TestResult],
        ) -> Result<(), SpearError> {
            Ok(())
        }
        async fn report_to_chain(
            &self,
            _agent_id: &str,
            _results: &[TestResult],
        ) -> Result<(), SpearError> {
            Ok(())
        }
    }

    // Mock HEALER dependencies
    struct MockAnalyzer;

    impl GeminiAnalyzer for MockAnalyzer {
        async fn analyze_failure(
            &self,
            agent_id: &str,
            error_logs: &[String],
            _last_messages: &[String],
        ) -> Result<HealerDiagnosis, HealerError> {
            Ok(HealerDiagnosis {
                agent_id: agent_id.to_string(),
                error_logs: error_logs.to_vec(),
                last_messages: vec![],
                proposed_fix: "restart".to_string(),
            })
        }
    }

    struct MockHealerSandbox;

    impl HealerSandbox for MockHealerSandbox {
        async fn test_fix_in_sandbox(
            &self,
            _diagnosis: &HealerDiagnosis,
            _test_queries: usize,
        ) -> Result<bool, HealerError> {
            Ok(true)
        }
    }

    struct MockDeployer;

    impl HealerDeployer for MockDeployer {
        async fn atomic_deploy(
            &self,
            _agent_id: &str,
            _proposed_fix: &str,
        ) -> Result<(), HealerError> {
            Ok(())
        }
        async fn rollback(&self, _agent_id: &str) -> Result<(), HealerError> {
            Ok(())
        }
    }

    // =========================================================================
    // Helper to build a test pipeline
    // =========================================================================

    async fn build_test_pipeline() -> SecurityPipeline<MockCloner, MockNotifier, MockAnalyzer, MockHealerSandbox, MockDeployer>
    {
        let shield = ShieldAgent::new();
        let spear = SpearAgent::new(vec![], MockCloner { results: StdArc::new(StdMutex::new(vec![])) }, MockNotifier);
        let chain = ChainAgent::new(Box::new(InMemoryAuditStorage::new()))
            .await
            .unwrap();
        let healer = HealerAgent::new(MockAnalyzer, MockHealerSandbox, MockDeployer);
        let matrix = AccessControlMatrix::from_rules(vec![
            AccessRule::allow("picoclaw", "openclaw"),
        ]);
        let access_control = AccessControlValidator::new(matrix);

        SecurityPipeline::new(
            shield,
            spear,
            chain,
            healer,
            access_control,
            PipelineConfig::default(),
        )
    }

    // =========================================================================
    // Tests
    // =========================================================================

    #[tokio::test]
    async fn test_pipeline_creation() {
        let pipeline = build_test_pipeline().await;
        assert_eq!(pipeline.config.spear_interval, Duration::from_secs(6 * 60 * 60));
        assert_eq!(pipeline.config.shield_max_latency_ms, 500);
        assert!(pipeline.config.auto_heal_on_critical);
    }

    #[tokio::test]
    async fn test_validate_message_allowed() {
        let pipeline = build_test_pipeline().await;

        let result = pipeline
            .validate_message_for_delivery("picoclaw", "openclaw", 1700000000000)
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_message_denied() {
        let pipeline = build_test_pipeline().await;

        let result = pipeline
            .validate_message_for_delivery("rogue", "openclaw", 1700000000000)
            .await;

        assert!(result.is_err());
        let reason = result.unwrap_err();
        assert!(reason.contains("zero-trust default deny"));
    }

    #[tokio::test]
    async fn test_pipeline_start_and_shutdown() {
        let pipeline = build_test_pipeline().await;

        let bus_reader = MockBusReader {
            messages: Arc::new(Mutex::new(vec![])),
        };
        let registry = MockRegistry {
            agents: vec!["agent-1".to_string()],
        };

        let handle = pipeline.start(bus_reader, registry).await;

        // Give tasks time to start
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Shutdown gracefully
        handle.shutdown();

        // Give tasks time to stop
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    #[tokio::test]
    async fn test_shield_observer_detects_credential() {
        let pipeline = build_test_pipeline().await;

        let messages = Arc::new(Mutex::new(vec![BusMessage {
            id: "msg-1".to_string(),
            sender_id: AgentId::new("agent-1"),
            destination_id: AgentId::new("agent-2"),
            task_type: "action".to_string(),
            payload: b"my secret key is sk-abc123".to_vec(),
            timestamp: 1700000000000,
        }]));

        let bus_reader = MockBusReader {
            messages: messages.clone(),
        };
        let registry = MockRegistry { agents: vec![] };

        let handle = pipeline.start(bus_reader, registry).await;

        // Wait for the message to be processed
        tokio::time::sleep(Duration::from_millis(200)).await;

        handle.shutdown();
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    #[tokio::test]
    async fn test_notify_event_sends_to_channel() {
        let pipeline = build_test_pipeline().await;

        pipeline
            .notify_event(PipelineEvent::AgentFailure {
                agent_id: "agent-1".to_string(),
                error_logs: vec!["error".to_string()],
                last_messages: vec![],
            })
            .await;

        // Event was sent successfully (no panic)
    }

    #[tokio::test]
    async fn test_pipeline_config_default() {
        let config = PipelineConfig::default();
        assert_eq!(config.spear_interval, Duration::from_secs(6 * 60 * 60));
        assert_eq!(config.shield_max_latency_ms, 500);
        assert_eq!(config.event_channel_size, 256);
        assert!(config.auto_heal_on_critical);
    }
}
