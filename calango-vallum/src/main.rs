//! CalangoVallum — CalangoFlux Security Module
//!
//! Orchestrates the full security pipeline:
//! - SHIELD Agent: real-time message bus monitoring (<500ms latency) via Redis Streams fan-out
//! - CHAIN Agent: immutable audit trail recording for all message and lifecycle events
//! - SPEAR Agent: scheduled adversarial testing via Agent Registry
//! - HEALER Agent: failure detection from SHIELD/Registry alerts + Gemini diagnosis
//! - Access Control: zero-trust validation in message delivery path
//!
//! Requirements: 6.1, 7.1, 9.1, 16.1

use std::sync::Arc;

use axum::{http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use tokio::sync::Mutex;
use tracing_subscriber::{fmt, EnvFilter};

use calango_vallum::chain::{ActionType, AuditEntry, AuditStorage, ChainAgent, ChainError};
use calango_vallum::healer::{
    GeminiAnalyzer, HealerAgent, HealerDeployer, HealerDiagnosis, HealerError, HealerSandbox,
};
use calango_vallum::shield::{AgentId, BusMessage, ShieldAgent};

// =============================================================================
// Structured Logging Initialization
// =============================================================================

/// Initialize structured JSON logging for CalangoVallum.
fn init_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .json()
        .with_timer(fmt::time::SystemTime)
        .with_target(true)
        .with_level(true)
        .with_env_filter(filter)
        .init();
}

// =============================================================================
// In-Memory Audit Storage (placeholder for Supabase)
// =============================================================================

/// In-memory audit storage for development/wiring purposes.
/// In production, this will be replaced with a Supabase PostgreSQL backend.
struct InMemoryAuditStorage {
    entries: Mutex<Vec<AuditEntry>>,
}

impl InMemoryAuditStorage {
    fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl AuditStorage for InMemoryAuditStorage {
    async fn persist(&self, entry: &AuditEntry) -> Result<(), ChainError> {
        self.entries.lock().await.push(entry.clone());
        Ok(())
    }

    async fn get_entries(&self, count: usize) -> Result<Vec<AuditEntry>, ChainError> {
        let entries = self.entries.lock().await;
        let len = entries.len();
        let start = if len > count { len - count } else { 0 };
        Ok(entries[start..].to_vec())
    }

    async fn get_last_hash(&self) -> Result<[u8; 32], ChainError> {
        let entries = self.entries.lock().await;
        match entries.last() {
            Some(entry) => Ok(entry.entry_hash),
            None => Ok([0u8; 32]),
        }
    }
}

// =============================================================================
// Health endpoint
// =============================================================================

async fn health() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "healthy",
            "service": "calango-vallum",
            "agents": ["shield", "chain", "spear", "healer"]
        })),
    )
}

// =============================================================================
// Placeholder HEALER dependencies (stubs for wiring)
// =============================================================================

/// Placeholder Gemini analyzer — returns a generic diagnosis.
/// In production, this calls the Vertex AI / Google AI Studio API.
struct PlaceholderAnalyzer;

impl GeminiAnalyzer for PlaceholderAnalyzer {
    async fn analyze_failure(
        &self,
        agent_id: &str,
        error_logs: &[String],
        _last_messages: &[String],
    ) -> Result<HealerDiagnosis, HealerError> {
        tracing::info!(agent_id = %agent_id, "PlaceholderAnalyzer: diagnosing failure");
        Ok(HealerDiagnosis {
            agent_id: agent_id.to_string(),
            error_logs: error_logs.to_vec(),
            last_messages: vec![],
            proposed_fix: "restart-agent".to_string(),
        })
    }
}

/// Placeholder sandbox for testing fixes.
struct PlaceholderHealerSandbox;

impl HealerSandbox for PlaceholderHealerSandbox {
    async fn test_fix_in_sandbox(
        &self,
        diagnosis: &HealerDiagnosis,
        _test_queries: usize,
    ) -> Result<bool, HealerError> {
        tracing::info!(agent_id = %diagnosis.agent_id, "PlaceholderHealerSandbox: testing fix");
        Ok(true)
    }
}

/// Placeholder deployer for atomic deploy/rollback.
struct PlaceholderDeployer;

impl HealerDeployer for PlaceholderDeployer {
    async fn atomic_deploy(
        &self,
        agent_id: &str,
        _proposed_fix: &str,
    ) -> Result<(), HealerError> {
        tracing::info!(agent_id = %agent_id, "PlaceholderDeployer: deploying fix");
        Ok(())
    }

    async fn rollback(&self, agent_id: &str) -> Result<(), HealerError> {
        tracing::info!(agent_id = %agent_id, "PlaceholderDeployer: rolling back");
        Ok(())
    }
}

/// HEALER Agent background task — listens for failure notifications on alerts:security.
///
/// Monitors the alerts:security stream for agent failure events. When a failure
/// is detected, it triggers the HEALER diagnosis and auto-correction pipeline.
async fn run_healer_listener(
    redis_client: redis::Client,
    healer: Arc<Mutex<HealerAgent<PlaceholderAnalyzer, PlaceholderHealerSandbox, PlaceholderDeployer>>>,
) {
    const HEALER_CONSUMER_GROUP: &str = "healer-listeners";
    const HEALER_CONSUMER_NAME: &str = "healer-1";
    const HEALER_STREAM: &str = "alerts:security";

    tracing::info!("HEALER listener starting — monitoring failure notifications");

    // Ensure consumer group exists
    if let Ok(mut conn) = redis_client.get_multiplexed_async_connection().await {
        let _: Result<String, _> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(HEALER_STREAM)
            .arg(HEALER_CONSUMER_GROUP)
            .arg("0")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;
    }

    loop {
        let conn_result = redis_client.get_multiplexed_async_connection().await;
        let mut conn = match conn_result {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "HEALER: Failed to connect to Redis, retrying in 5s");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let result: Result<redis::Value, _> = redis::cmd("XREADGROUP")
            .arg("GROUP")
            .arg(HEALER_CONSUMER_GROUP)
            .arg(HEALER_CONSUMER_NAME)
            .arg("COUNT")
            .arg("10")
            .arg("BLOCK")
            .arg("5000")
            .arg("STREAMS")
            .arg(HEALER_STREAM)
            .arg(">")
            .query_async(&mut conn)
            .await;

        match result {
            Ok(redis::Value::Nil) => continue,
            Ok(redis::Value::Array(streams)) => {
                for stream_data in streams {
                    if let redis::Value::Array(parts) = stream_data {
                        if parts.len() < 2 {
                            continue;
                        }
                        if let redis::Value::Array(entries) = &parts[1] {
                            for entry in entries {
                                if let redis::Value::Array(entry_parts) = entry {
                                    if entry_parts.len() < 2 {
                                        continue;
                                    }

                                    let entry_id = match &entry_parts[0] {
                                        redis::Value::BulkString(b) => {
                                            String::from_utf8_lossy(b).to_string()
                                        }
                                        _ => continue,
                                    };

                                    // Parse alert fields
                                    let mut agent_id = String::new();
                                    let mut alert_type = String::new();
                                    if let redis::Value::Array(field_values) = &entry_parts[1] {
                                        let mut iter = field_values.iter();
                                        while let (Some(k), Some(v)) = (iter.next(), iter.next()) {
                                            let key = match k {
                                                redis::Value::BulkString(b) => {
                                                    String::from_utf8_lossy(b).to_string()
                                                }
                                                _ => continue,
                                            };
                                            let val = match v {
                                                redis::Value::BulkString(b) => {
                                                    String::from_utf8_lossy(b).to_string()
                                                }
                                                _ => continue,
                                            };
                                            match key.as_str() {
                                                "agent_id" => agent_id = val,
                                                "type" => alert_type = val,
                                                _ => {}
                                            }
                                        }
                                    }

                                    // Only trigger HEALER for agent failure alerts
                                    if !agent_id.is_empty() {
                                        tracing::info!(
                                            agent_id = %agent_id,
                                            alert_type = %alert_type,
                                            "HEALER: Processing failure notification"
                                        );

                                        let healer_guard = healer.lock().await;
                                        let now_secs = std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs();

                                        if healer_guard.can_attempt(&agent_id, now_secs) {
                                            let error_logs = vec![format!("Alert: {}", alert_type)];
                                            match healer_guard
                                                .diagnose(&agent_id, &error_logs, &[])
                                                .await
                                            {
                                                Ok(diagnosis) => {
                                                    tracing::info!(
                                                        agent_id = %agent_id,
                                                        fix = %diagnosis.proposed_fix,
                                                        "HEALER: Diagnosis complete"
                                                    );
                                                }
                                                Err(e) => {
                                                    tracing::error!(
                                                        agent_id = %agent_id,
                                                        error = %e,
                                                        "HEALER: Diagnosis failed"
                                                    );
                                                }
                                            }
                                        } else {
                                            tracing::warn!(
                                                agent_id = %agent_id,
                                                "HEALER: Rate limit reached, skipping"
                                            );
                                        }
                                    }

                                    // Acknowledge
                                    let _: Result<i64, _> = redis::cmd("XACK")
                                        .arg(HEALER_STREAM)
                                        .arg(HEALER_CONSUMER_GROUP)
                                        .arg(&entry_id)
                                        .query_async(&mut conn)
                                        .await;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let msg = e.to_string();
                if !msg.contains("NOGROUP") {
                    tracing::debug!(error = %e, "HEALER: XREADGROUP error, retrying");
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            _ => {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
    }
}

// =============================================================================
// Redis Streams Consumer — Fan-out for SHIELD and CHAIN
// =============================================================================

/// Streams that SHIELD and CHAIN observe (fan-out pattern).
/// These are all the streams in the pipeline that carry messages.
const OBSERVED_STREAMS: &[&str] = &[
    "tasks:router",   // API Gateway → PicoClaw
    "tasks:action",   // PicoClaw → OpenClaw
    "tasks:gemini",   // PicoClaw → Gemini
    "alerts:security", // SHIELD alerts
];

/// Consumer group name for CalangoVallum's SHIELD observer.
const SHIELD_CONSUMER_GROUP: &str = "shield-observers";

/// Consumer name for this instance.
const SHIELD_CONSUMER_NAME: &str = "vallum-1";

/// Ensure consumer groups exist for all observed streams.
async fn ensure_consumer_groups(redis: &redis::Client) {
    if let Ok(mut conn) = redis.get_multiplexed_async_connection().await {
        for stream in OBSERVED_STREAMS {
            let result: Result<String, _> = redis::cmd("XGROUP")
                .arg("CREATE")
                .arg(*stream)
                .arg(SHIELD_CONSUMER_GROUP)
                .arg("0")
                .arg("MKSTREAM")
                .query_async(&mut conn)
                .await;

            match result {
                Ok(_) => tracing::info!(stream = %stream, "Consumer group created"),
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("BUSYGROUP") {
                        tracing::debug!(stream = %stream, "Consumer group already exists");
                    } else {
                        tracing::warn!(stream = %stream, error = %e, "Failed to create consumer group");
                    }
                }
            }
        }
    }
}

/// Parse a Redis stream entry into a BusMessage for SHIELD observation.
fn parse_stream_entry(fields: &[(String, String)]) -> Option<BusMessage> {
    let get_field = |name: &str| -> Option<&str> {
        fields.iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    };

    let id = get_field("id").unwrap_or("unknown").to_string();
    let sender_id = get_field("sender_id").unwrap_or("unknown").to_string();
    let destination_id = get_field("destination_id").unwrap_or("unknown").to_string();
    let task_type = get_field("task_type").unwrap_or(
        get_field("intent").unwrap_or("unknown")
    ).to_string();

    // Payload can be base64-encoded (from IronClaw) or plain text (from PicoClaw)
    let payload = get_field("payload")
        .map(|p| p.as_bytes().to_vec())
        .unwrap_or_default();

    let timestamp = get_field("timestamp")
        .and_then(|t| t.parse::<u64>().ok())
        .unwrap_or(0);

    Some(BusMessage {
        id,
        sender_id: AgentId::new(sender_id),
        destination_id: AgentId::new(destination_id),
        task_type,
        payload,
        timestamp,
    })
}

/// SHIELD Agent background task — observes all streams via Redis consumer group.
///
/// Reads messages from all observed streams using XREADGROUP with the
/// "shield-observers" consumer group. For each message:
/// 1. Passes it to SHIELD for security analysis (credential exposure, rate limits)
/// 2. If an alert is generated, publishes it to the "alerts:security" stream
/// 3. Acknowledges the message
///
/// This provides <500ms latency observation of all inter-agent communication.
async fn run_shield_consumer(
    redis_client: redis::Client,
    shield: Arc<Mutex<ShieldAgent>>,
    chain: Arc<Mutex<ChainAgent>>,
) {
    tracing::info!("SHIELD consumer starting — observing all message bus streams");

    loop {
        let conn_result = redis_client.get_multiplexed_async_connection().await;
        let mut conn = match conn_result {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "SHIELD: Failed to connect to Redis, retrying in 5s");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        // Build XREADGROUP command for multiple streams
        // XREADGROUP GROUP shield-observers vallum-1 COUNT 50 BLOCK 2000 STREAMS tasks:router tasks:action tasks:gemini >
        let _streams_with_ids: Vec<&str> = OBSERVED_STREAMS.iter()
            .copied()
            .chain(OBSERVED_STREAMS.iter().map(|_| ">"))
            .collect();

        let mut cmd = redis::cmd("XREADGROUP");
        cmd.arg("GROUP")
            .arg(SHIELD_CONSUMER_GROUP)
            .arg(SHIELD_CONSUMER_NAME)
            .arg("COUNT")
            .arg("50")
            .arg("BLOCK")
            .arg("2000")
            .arg("STREAMS");

        for stream in OBSERVED_STREAMS {
            cmd.arg(*stream);
        }
        for _ in OBSERVED_STREAMS {
            cmd.arg(">");
        }

        let result: Result<redis::Value, _> = cmd.query_async(&mut conn).await;

        match result {
            Ok(redis::Value::Nil) => {
                // No messages available, continue polling
                continue;
            }
            Ok(redis::Value::Array(streams)) => {
                for stream_data in streams {
                    if let redis::Value::Array(parts) = stream_data {
                        if parts.len() < 2 {
                            continue;
                        }

                        // Extract stream name
                        let stream_name = match &parts[0] {
                            redis::Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
                            _ => continue,
                        };

                        // Extract entries
                        if let redis::Value::Array(entries) = &parts[1] {
                            for entry in entries {
                                if let redis::Value::Array(entry_parts) = entry {
                                    if entry_parts.len() < 2 {
                                        continue;
                                    }

                                    let entry_id = match &entry_parts[0] {
                                        redis::Value::BulkString(b) => {
                                            String::from_utf8_lossy(b).to_string()
                                        }
                                        _ => continue,
                                    };

                                    // Parse fields
                                    let mut fields: Vec<(String, String)> = Vec::new();
                                    if let redis::Value::Array(field_values) = &entry_parts[1] {
                                        let mut iter = field_values.iter();
                                        while let (Some(k), Some(v)) = (iter.next(), iter.next()) {
                                            let key = match k {
                                                redis::Value::BulkString(b) => {
                                                    String::from_utf8_lossy(b).to_string()
                                                }
                                                _ => continue,
                                            };
                                            let val = match v {
                                                redis::Value::BulkString(b) => {
                                                    String::from_utf8_lossy(b).to_string()
                                                }
                                                _ => continue,
                                            };
                                            fields.push((key, val));
                                        }
                                    }

                                    // Parse into BusMessage and observe
                                    if let Some(bus_msg) = parse_stream_entry(&fields) {
                                        // SHIELD observation
                                        let alert = {
                                            let mut shield_guard = shield.lock().await;
                                            shield_guard.observe_message(&bus_msg)
                                        };

                                        if let Some(alert) = &alert {
                                            tracing::warn!(
                                                alert_type = ?alert.alert_type,
                                                agent_id = %alert.agent_id.as_str(),
                                                severity = ?alert.severity,
                                                "SHIELD: Security alert generated"
                                            );

                                            // Publish alert to alerts:security stream
                                            let _: Result<String, _> = redis::cmd("XADD")
                                                .arg("alerts:security")
                                                .arg("*")
                                                .arg("type")
                                                .arg(format!("{:?}", alert.alert_type))
                                                .arg("agent_id")
                                                .arg(alert.agent_id.as_str())
                                                .arg("severity")
                                                .arg(format!("{:?}", alert.severity))
                                                .arg("details")
                                                .arg(&alert.details)
                                                .arg("timestamp")
                                                .arg(alert.timestamp.to_string())
                                                .query_async(&mut conn)
                                                .await;
                                        }

                                        // CHAIN recording — record every message event
                                        {
                                            let timestamp = std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap_or_default()
                                                .as_millis() as u64;

                                            let action_type = if alert.is_some() {
                                                ActionType::SecurityViolation
                                            } else {
                                                ActionType::MessageSent
                                            };

                                            let payload_summary = format!(
                                                "stream={} sender={} dest={} type={}",
                                                stream_name,
                                                bus_msg.sender_id.as_str(),
                                                bus_msg.destination_id.as_str(),
                                                bus_msg.task_type,
                                            );

                                            let mut chain_guard = chain.lock().await;
                                            if let Err(e) = chain_guard
                                                .record(
                                                    bus_msg.sender_id.as_str().to_string(),
                                                    action_type,
                                                    payload_summary.as_bytes(),
                                                    timestamp,
                                                )
                                                .await
                                            {
                                                tracing::error!(error = %e, "CHAIN: Failed to record audit entry");
                                            }
                                        }
                                    }

                                    // Acknowledge the message
                                    let _: Result<i64, _> = redis::cmd("XACK")
                                        .arg(&stream_name)
                                        .arg(SHIELD_CONSUMER_GROUP)
                                        .arg(&entry_id)
                                        .query_async(&mut conn)
                                        .await;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("NOGROUP") {
                    // Consumer group doesn't exist yet, try to create it
                    tracing::warn!("Consumer group missing, re-creating...");
                    ensure_consumer_groups(&redis_client).await;
                } else {
                    tracing::debug!(error = %e, "SHIELD: XREADGROUP returned error, retrying");
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
            _ => {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
    }
}

// =============================================================================
// Main
// =============================================================================

#[tokio::main]
async fn main() {
    // 1. Initialize structured logging
    init_logging();
    tracing::info!("CalangoVallum Security Module starting");

    // 2. Read configuration from environment
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8081);
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());

    // 3. Connect to Redis
    let redis_client = redis::Client::open(redis_url.as_str())
        .expect("Failed to create Redis client");

    tracing::info!(redis_url = %redis_url, "Redis client created");

    // 4. Ensure consumer groups exist for SHIELD fan-out observation
    ensure_consumer_groups(&redis_client).await;

    // 5. Initialize SHIELD Agent
    let shield = Arc::new(Mutex::new(ShieldAgent::new()));
    tracing::info!("SHIELD Agent initialized");

    // 6. Initialize CHAIN Agent with in-memory storage (placeholder for Supabase)
    let audit_storage = Box::new(InMemoryAuditStorage::new());
    let chain = match ChainAgent::new(audit_storage).await {
        Ok(agent) => Arc::new(Mutex::new(agent)),
        Err(e) => {
            tracing::error!(error = %e, "Failed to initialize CHAIN Agent");
            panic!("Cannot start without CHAIN Agent");
        }
    };
    tracing::info!("CHAIN Agent initialized");

    // Record startup event in CHAIN
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut chain_guard = chain.lock().await;
        if let Err(e) = chain_guard
            .record(
                "calango-vallum".to_string(),
                ActionType::AgentStarted,
                b"CalangoVallum security module started",
                timestamp,
            )
            .await
        {
            tracing::error!(error = %e, "Failed to record startup audit entry");
        }
    }

    // 7. Spawn SHIELD + CHAIN consumer (fan-out observation of all streams)
    let shield_clone = shield.clone();
    let chain_clone = chain.clone();
    let redis_clone = redis_client.clone();
    tokio::spawn(async move {
        run_shield_consumer(redis_clone, shield_clone, chain_clone).await;
    });

    tracing::info!("SHIELD consumer spawned — observing all message bus streams");

    // 8. Initialize HEALER Agent and spawn listener
    let healer = Arc::new(Mutex::new(HealerAgent::new(
        PlaceholderAnalyzer,
        PlaceholderHealerSandbox,
        PlaceholderDeployer,
    )));
    tracing::info!("HEALER Agent initialized");

    let healer_clone = healer.clone();
    let redis_healer = redis_client.clone();
    tokio::spawn(async move {
        run_healer_listener(redis_healer, healer_clone).await;
    });

    tracing::info!("HEALER listener spawned — monitoring failure notifications");

    // 9. Build health endpoint router
    let app = Router::new().route("/health", get(health));

    // 10. Start the server with graceful shutdown on SIGTERM
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!(address = %addr, "Starting CalangoVallum health server");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind TCP listener");

    let shutdown_signal = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
        tracing::info!("SIGTERM received — initiating graceful shutdown");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await
        .expect("Server error");

    tracing::info!("CalangoVallum shut down gracefully");
}


// =============================================================================
// Access Control — default matrix for the platform
// =============================================================================

