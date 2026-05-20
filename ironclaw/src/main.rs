//! IronClaw — CalangoFlux Agentic OS Runtime
//!
//! Wires all IronClaw components together:
//! - Structured logging
//! - Redis-backed Message Bus
//! - Access Control Matrix
//! - Credential Vault
//! - Agent Registry
//! - API Gateway (REST via axum)
//!
//! Requirements: 3.4, 4.1, 10.2, 11.5

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::{http::StatusCode, response::IntoResponse, routing::get, Json};
use tokio::sync::Mutex;

use ironclaw::access_control::{AccessControlMatrix, AccessRule};
use ironclaw::api_gateway::{ApiGateway, AppState, MessageBusPublisher, RateLimiter, TaskMessage};
use ironclaw::credential_vault::{CredentialError, CredentialVault, SecretId, SecretManagerClient};
use ironclaw::logging;
use ironclaw::message_bus::{MessageBusClient, RealRedisConnection};
use ironclaw::types::AgentId;

// =============================================================================
// Placeholder SecretManagerClient (for wiring; real impl uses Google Secret Manager)
// =============================================================================

/// Placeholder secret manager that returns a dummy secret for any request.
/// In production, this will be replaced with the Google Secret Manager client.
struct PlaceholderSecretManager;

#[async_trait::async_trait]
impl SecretManagerClient for PlaceholderSecretManager {
    async fn get_secret(
        &self,
        secret_id: &SecretId,
    ) -> Result<Vec<u8>, CredentialError> {
        tracing::warn!(
            secret_id = secret_id.as_str(),
            "PlaceholderSecretManager: returning dummy secret"
        );
        Ok(format!("placeholder-secret-for-{}", secret_id.as_str()).into_bytes())
    }
}

// =============================================================================
// MessageBusPublisher adapter (bridges ApiGateway to MessageBusClient)
// =============================================================================

/// Adapter that implements `MessageBusPublisher` by delegating to a real
/// `MessageBusClient<RealRedisConnection>`.
///
/// Routes all incoming tasks to the PicoClaw router stream (`tasks:router`)
/// which is consumed by the `picoclaw-workers` consumer group.
/// This is the entry point for the full pipeline:
///   request → auth → publish(tasks:router) → PicoClaw classify → route → execute → respond
struct MessageBusAdapter {
    client: Arc<Mutex<MessageBusClient<RealRedisConnection>>>,
}

#[async_trait::async_trait]
impl MessageBusPublisher for MessageBusAdapter {
    async fn publish_task(&self, task: TaskMessage) -> Result<String, String> {
        use ironclaw::types::BusMessage;

        // Route to PicoClaw's input stream: "tasks:router"
        // PicoClaw consumer group "picoclaw-workers" reads from this stream,
        // classifies intent, and routes to the appropriate downstream agent.
        let msg = BusMessage {
            id: task.id,
            sender_id: AgentId::new("api-gateway"),
            destination_id: AgentId::new("router"),
            task_type: task.task_type,
            payload: task.payload,
            timestamp: task.timestamp,
        };

        let mut client = self.client.lock().await;
        client.publish(msg).await.map_err(|e| e.to_string())
    }
}

// =============================================================================
// Placeholder SandboxProvider and NotificationService for AgentRegistry
// =============================================================================

use ironclaw::agent_registry::{
    AgentRegistry, NotificationService, ResourceUsage, SandboxConfig, SandboxProvider,
};

/// Placeholder sandbox provider — logs operations but doesn't run real WASM.
struct PlaceholderSandbox;

#[async_trait::async_trait]
impl SandboxProvider for PlaceholderSandbox {
    async fn provision(&self, agent_id: &AgentId, _config: &SandboxConfig) -> Result<(), String> {
        tracing::info!(agent_id = agent_id.as_str(), "Placeholder: sandbox provisioned");
        Ok(())
    }

    async fn health_check(&self, _agent_id: &AgentId) -> bool {
        true
    }

    async fn terminate(&self, agent_id: &AgentId) -> Result<(), String> {
        tracing::info!(agent_id = agent_id.as_str(), "Placeholder: sandbox terminated");
        Ok(())
    }

    fn resource_usage(&self, _agent_id: &AgentId) -> ResourceUsage {
        ResourceUsage::default()
    }
}

/// Placeholder notification service — logs notifications.
struct PlaceholderNotifier;

#[async_trait::async_trait]
impl NotificationService for PlaceholderNotifier {
    async fn notify_shield(&self, agent_id: &AgentId) -> Result<(), String> {
        tracing::warn!(agent_id = agent_id.as_str(), "SHIELD notification: agent dead");
        Ok(())
    }

    async fn alert_admin(&self, agent_id: &AgentId) -> Result<(), String> {
        tracing::warn!(agent_id = agent_id.as_str(), "Admin alert: agent dead");
        Ok(())
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
            "service": "ironclaw",
            "version": env!("CARGO_PKG_VERSION")
        })),
    )
}

// =============================================================================
// Main
// =============================================================================

#[tokio::main]
async fn main() {
    // 1. Initialize structured logging
    logging::init();
    tracing::info!("IronClaw Agent OS Runtime starting");

    // 2. Read configuration from environment
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-jwt-secret-change-me".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    // 3. Create Redis connection for Message Bus
    let redis_conn = match RealRedisConnection::new(&redis_url) {
        Ok(conn) => {
            tracing::info!(redis_url = %redis_url, "Redis connection established");
            conn
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to connect to Redis — starting without bus");
            // Create a connection anyway (it will fail on publish, but the server can still start)
            RealRedisConnection::new("redis://127.0.0.1:6379")
                .expect("Failed to create fallback Redis client")
        }
    };

    // 4. Create Access Control Matrix with default rules
    //
    // Full pipeline flow:
    //   api-gateway → router (PicoClaw input stream)
    //   picoclaw → action (OpenClaw input stream)
    //   picoclaw → gemini (Gemini conversations/analysis)
    //   openclaw → api-gateway (action results/responses)
    //   gemini → api-gateway (conversation responses)
    //   shield → all (fan-out monitoring)
    //   chain → all (audit recording)
    //   healer → agent-registry (auto-correction)
    let access_matrix = AccessControlMatrix::from_rules(vec![
        // API Gateway → PicoClaw router stream (task routing entry point)
        AccessRule::allow(AgentId::new("api-gateway"), AgentId::new("router")),
        // PicoClaw → OpenClaw (action execution)
        AccessRule::allow(AgentId::new("picoclaw"), AgentId::new("action")),
        // PicoClaw → Gemini (conversation/analysis routing)
        AccessRule::allow(AgentId::new("picoclaw"), AgentId::new("gemini")),
        // OpenClaw → API Gateway (action results published back)
        AccessRule::allow(AgentId::new("openclaw"), AgentId::new("api-gateway")),
        // Gemini → API Gateway (conversation responses)
        AccessRule::allow(AgentId::new("gemini"), AgentId::new("api-gateway")),
        // SHIELD → all (monitoring, can publish alerts to any stream)
        AccessRule::allow(AgentId::new("shield"), AgentId::new("api-gateway")),
        AccessRule::allow(AgentId::new("shield"), AgentId::new("router")),
        AccessRule::allow(AgentId::new("shield"), AgentId::new("action")),
        AccessRule::allow(AgentId::new("shield"), AgentId::new("gemini")),
        // CHAIN → audit recording (can read from all streams)
        AccessRule::allow(AgentId::new("chain"), AgentId::new("api-gateway")),
        AccessRule::allow(AgentId::new("chain"), AgentId::new("router")),
        AccessRule::allow(AgentId::new("chain"), AgentId::new("action")),
        // HEALER → Agent Registry
        AccessRule::allow(AgentId::new("healer"), AgentId::new("agent-registry")),
    ]);

    // 5. Create MessageBusClient
    let message_bus_client = Arc::new(Mutex::new(MessageBusClient::new(redis_conn, access_matrix)));
    tracing::info!("Message Bus client initialized");

    // 5b. Ensure consumer groups exist for all streams in the pipeline.
    // This is idempotent — if groups already exist, the error is ignored.
    {
        let client = message_bus_client.lock().await;
        let streams_and_groups = [
            ("tasks:router", "picoclaw-workers"),
            ("tasks:action", "openclaw-workers"),
            ("tasks:gemini", "openclaw-workers"),
            ("tasks:router", "shield-observers"),
            ("tasks:action", "shield-observers"),
            ("tasks:gemini", "shield-observers"),
            ("alerts:security", "shield-observers"),
        ];
        for (stream, group) in &streams_and_groups {
            if let Err(e) = client.ensure_consumer_group(stream, group).await {
                tracing::debug!(stream = %stream, group = %group, error = %e, "Consumer group setup (may already exist)");
            } else {
                tracing::info!(stream = %stream, group = %group, "Consumer group ensured");
            }
        }
    }

    // 6. Create Credential Vault with placeholder backend
    let ownership_map: HashMap<AgentId, Vec<SecretId>> = HashMap::new();
    let _credential_vault = CredentialVault::new(
        Box::new(PlaceholderSecretManager),
        ownership_map,
    );
    tracing::info!("Credential Vault initialized (placeholder backend)");

    // 7. Create Agent Registry with placeholder sandbox provider
    let _agent_registry = AgentRegistry::new(PlaceholderSandbox, PlaceholderNotifier);
    tracing::info!("Agent Registry initialized");

    // 8. Create API Gateway
    let rate_limiter = RateLimiter::new(60, Duration::from_secs(60));
    let bus_adapter = Arc::new(MessageBusAdapter {
        client: message_bus_client.clone(),
    });
    let gateway = Arc::new(ApiGateway::new(
        jwt_secret.into_bytes(),
        rate_limiter,
        bus_adapter,
    ));
    tracing::info!("API Gateway initialized");

    // 9. Build axum router
    let app_state = AppState {
        gateway: gateway.clone(),
    };
    let app = ironclaw::api_gateway::rest_router(app_state)
        .route("/health", get(health));

    // 10. Start response stream listener (reads responses from OpenClaw/Gemini)
    // In production, this would match responses to pending client requests.
    // For now, it logs responses for observability.
    let response_bus = message_bus_client.clone();
    tokio::spawn(async move {
        tracing::info!("Response listener started — monitoring responses:* streams");
        // The response listener would poll for responses and deliver them
        // back to waiting HTTP connections. This is a placeholder that
        // demonstrates the wiring is in place.
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            tracing::debug!("Response listener heartbeat");
            let _ = &response_bus; // Keep reference alive
        }
    });

    // 11. Start the server with graceful shutdown on SIGTERM
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!(address = %addr, "Starting IronClaw REST server");

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

    tracing::info!("IronClaw shut down gracefully");
}
