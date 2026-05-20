//! API Gateway — gRPC + REST interface with JWT authentication and rate limiting.
//!
//! Provides the unified entry point for CalangoBot and Admin Dashboard to communicate
//! with the CalangoFlux Agentic OS. Supports both gRPC (tonic) and REST (axum) endpoints.
//!
//! Key behaviors:
//! - JWT validation (valid, expired, malformed, missing tokens → 401)
//! - Rate limiting: 60 requests/minute per authenticated client (sliding window)
//! - Publishes authenticated tasks to the message bus within 100ms

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::types::AgentId;

// =============================================================================
// JWT Types
// =============================================================================

/// Role assigned to a JWT subject.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum Role {
    Admin,
    Agent(AgentId),
    Public,
}

/// JWT claims for authenticated requests.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JwtClaims {
    /// Subject (user or agent ID).
    pub sub: String,
    /// Role of the subject.
    pub role: Role,
    /// Expiration timestamp (seconds since epoch).
    pub exp: u64,
    /// Issued-at timestamp (seconds since epoch).
    pub iat: u64,
}

// =============================================================================
// Error Types
// =============================================================================

/// Authentication errors returned by JWT validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// Token is missing from the request.
    MissingToken,
    /// Token is malformed (cannot be decoded).
    MalformedToken,
    /// Token signature is invalid.
    InvalidSignature,
    /// Token has expired.
    ExpiredToken,
}

/// Rate limiting error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RateLimitError {
    /// Seconds until the client can retry.
    pub retry_after_secs: u64,
}

/// Gateway-level errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayError {
    Auth(AuthError),
    RateLimit(RateLimitError),
    BusPublishFailed(String),
}

// =============================================================================
// Rate Limiter — Sliding Window Counter
// =============================================================================

/// Sliding window rate limiter tracking requests per client.
/// Allows up to `max_requests` within a `window` duration.
#[derive(Debug, Clone)]
pub struct RateLimiter {
    /// Maximum requests allowed per window.
    max_requests: u64,
    /// Window duration.
    window: Duration,
    /// Per-client request timestamps (client_id → list of request timestamps in ms).
    clients: HashMap<String, Vec<u64>>,
}

impl RateLimiter {
    /// Create a new rate limiter with the given limit and window.
    pub fn new(max_requests: u64, window: Duration) -> Self {
        Self {
            max_requests,
            window,
            clients: HashMap::new(),
        }
    }

    /// Check if a client is within rate limits. If allowed, records the request.
    /// Returns `Ok(())` if allowed, `Err(RateLimitError)` if limit exceeded.
    pub fn check(&mut self, client_id: &str, now_ms: u64) -> Result<(), RateLimitError> {
        let window_ms = self.window.as_millis() as u64;
        let window_start = now_ms.saturating_sub(window_ms);

        let timestamps = self.clients.entry(client_id.to_string()).or_default();

        // Remove timestamps outside the current window.
        timestamps.retain(|&ts| ts > window_start);

        if timestamps.len() as u64 >= self.max_requests {
            // Calculate retry_after: time until the oldest request in window expires.
            let oldest = timestamps.first().copied().unwrap_or(now_ms);
            let retry_after_ms = oldest + window_ms - now_ms;
            let retry_after_secs = (retry_after_ms / 1000).max(1);
            return Err(RateLimitError {
                retry_after_secs,
            });
        }

        timestamps.push(now_ms);
        Ok(())
    }

    /// Get the current request count for a client within the window.
    pub fn current_count(&self, client_id: &str, now_ms: u64) -> u64 {
        let window_ms = self.window.as_millis() as u64;
        let window_start = now_ms.saturating_sub(window_ms);

        self.clients
            .get(client_id)
            .map(|timestamps| timestamps.iter().filter(|&&ts| ts > window_start).count() as u64)
            .unwrap_or(0)
    }
}

// =============================================================================
// Message Bus Client Trait
// =============================================================================

/// Trait for the message bus client, allowing mocking in tests.
#[async_trait::async_trait]
pub trait MessageBusPublisher: Send + Sync {
    /// Publish a task message to the bus. Returns the message ID on success.
    async fn publish_task(&self, task: TaskMessage) -> Result<String, String>;
}

/// A task message to be published to the message bus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMessage {
    pub id: String,
    pub sender_id: String,
    pub task_type: String,
    pub payload: Vec<u8>,
    pub timestamp: u64,
}

// =============================================================================
// API Gateway
// =============================================================================

/// The API Gateway service providing JWT auth, rate limiting, and message bus publishing.
pub struct ApiGateway {
    /// Secret key for JWT validation.
    jwt_secret: Vec<u8>,
    /// Rate limiter instance (shared, behind mutex for concurrent access).
    rate_limiter: Arc<Mutex<RateLimiter>>,
    /// Message bus client for publishing tasks.
    message_bus: Arc<dyn MessageBusPublisher>,
}

impl ApiGateway {
    /// Create a new API Gateway.
    pub fn new(
        jwt_secret: Vec<u8>,
        rate_limiter: RateLimiter,
        message_bus: Arc<dyn MessageBusPublisher>,
    ) -> Self {
        Self {
            jwt_secret,
            rate_limiter: Arc::new(Mutex::new(rate_limiter)),
            message_bus,
        }
    }

    /// Validate a JWT token and extract claims.
    /// Returns `AuthError` for missing, malformed, expired, or invalid tokens.
    pub fn validate_jwt(&self, token: &str) -> Result<JwtClaims, AuthError> {
        if token.is_empty() {
            return Err(AuthError::MissingToken);
        }

        let decoding_key = DecodingKey::from_secret(&self.jwt_secret);
        let mut validation = Validation::default();
        validation.validate_exp = true;
        validation.required_spec_claims.clear();

        match decode::<JwtClaims>(token, &decoding_key, &validation) {
            Ok(token_data) => Ok(token_data.claims),
            Err(err) => {
                use jsonwebtoken::errors::ErrorKind;
                match err.kind() {
                    ErrorKind::ExpiredSignature => Err(AuthError::ExpiredToken),
                    ErrorKind::InvalidSignature => Err(AuthError::InvalidSignature),
                    _ => Err(AuthError::MalformedToken),
                }
            }
        }
    }

    /// Check rate limit for a client. Records the request if allowed.
    pub async fn check_rate_limit(&self, client_id: &str) -> Result<(), RateLimitError> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut limiter = self.rate_limiter.lock().await;
        limiter.check(client_id, now_ms)
    }

    /// Handle an incoming request: authenticate, rate-check, and publish to message bus.
    pub async fn handle_request(
        &self,
        token: Option<&str>,
        payload: Vec<u8>,
        task_type: String,
    ) -> Result<String, GatewayError> {
        // 1. Authenticate
        let token_str = token.ok_or(GatewayError::Auth(AuthError::MissingToken))?;
        let claims = self.validate_jwt(token_str).map_err(GatewayError::Auth)?;

        // 2. Rate limit check
        self.check_rate_limit(&claims.sub)
            .await
            .map_err(GatewayError::RateLimit)?;

        // 3. Publish to message bus
        let task = TaskMessage {
            id: uuid::Uuid::new_v4().to_string(),
            sender_id: claims.sub.clone(),
            task_type,
            payload,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        };

        let msg_id = self
            .message_bus
            .publish_task(task)
            .await
            .map_err(GatewayError::BusPublishFailed)?;

        Ok(msg_id)
    }

    /// Generate a JWT token (utility for testing and token issuance).
    pub fn generate_jwt(&self, claims: &JwtClaims) -> Result<String, String> {
        let encoding_key = EncodingKey::from_secret(&self.jwt_secret);
        encode(&Header::default(), claims, &encoding_key).map_err(|e| e.to_string())
    }
}

// =============================================================================
// REST Endpoints (axum)
// =============================================================================

/// Shared state for axum handlers.
#[derive(Clone)]
pub struct AppState {
    pub gateway: Arc<ApiGateway>,
}

/// Request body for POST /api/tasks.
#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub task_type: String,
    pub payload: String,
}

/// Response body for POST /api/tasks.
#[derive(Debug, Serialize)]
pub struct CreateTaskResponse {
    pub message_id: String,
}

/// Error response body.
#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub error: String,
    pub code: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
}

/// Extract Bearer token from Authorization header.
fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// POST /api/tasks — Submit a task to the Agentic OS.
async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let token = extract_bearer_token(&headers);

    match state
        .gateway
        .handle_request(token, body.payload.into_bytes(), body.task_type)
        .await
    {
        Ok(message_id) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "message_id": message_id })),
        )
            .into_response(),
        Err(GatewayError::Auth(_)) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized", "code": 401 })),
        )
            .into_response(),
        Err(GatewayError::RateLimit(err)) => (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "Rate limit exceeded",
                "code": 429,
                "retry_after": err.retry_after_secs
            })),
        )
            .into_response(),
        Err(GatewayError::BusPublishFailed(msg)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": msg, "code": 500 })),
        )
            .into_response(),
    }
}

/// GET /api/health — Health check endpoint.
async fn health_check() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({ "status": "healthy" })),
    )
}

/// Build the axum REST router.
pub fn rest_router(state: AppState) -> Router {
    Router::new()
        .route("/api/tasks", post(create_task))
        .route("/api/health", get(health_check))
        .with_state(state)
}

// =============================================================================
// gRPC Service (tonic) — Stub
// =============================================================================

/// gRPC gateway service definition.
/// Note: Full proto compilation is not set up yet. This provides the service
/// structure that will be wired to generated code once protos are compiled.
pub mod grpc {
    use super::*;

    /// gRPC request for submitting a task.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SubmitTaskRequest {
        pub token: String,
        pub task_type: String,
        pub payload: Vec<u8>,
    }

    /// gRPC response for a submitted task.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SubmitTaskResponse {
        pub message_id: String,
    }

    /// gRPC health check response.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct HealthResponse {
        pub status: String,
    }

    /// The gRPC gateway service implementation.
    /// Once proto compilation is set up, this will implement the generated trait.
    pub struct GatewayGrpcService {
        pub gateway: Arc<ApiGateway>,
    }

    impl GatewayGrpcService {
        pub fn new(gateway: Arc<ApiGateway>) -> Self {
            Self { gateway }
        }

        /// Handle a gRPC SubmitTask call.
        pub async fn submit_task(
            &self,
            request: SubmitTaskRequest,
        ) -> Result<SubmitTaskResponse, GatewayError> {
            let token = if request.token.is_empty() {
                None
            } else {
                Some(request.token.as_str())
            };

            let message_id = self
                .gateway
                .handle_request(token, request.payload, request.task_type)
                .await?;

            Ok(SubmitTaskResponse { message_id })
        }

        /// Handle a gRPC Health check call.
        pub async fn health(&self) -> HealthResponse {
            HealthResponse {
                status: "healthy".to_string(),
            }
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- Mock Message Bus ---

    struct MockMessageBus {
        should_fail: bool,
    }

    #[async_trait::async_trait]
    impl MessageBusPublisher for MockMessageBus {
        async fn publish_task(&self, task: TaskMessage) -> Result<String, String> {
            if self.should_fail {
                Err("Bus unavailable".to_string())
            } else {
                Ok(format!("msg-{}", task.id))
            }
        }
    }

    fn test_secret() -> Vec<u8> {
        b"test-secret-key-for-jwt-validation".to_vec()
    }

    fn make_gateway(bus_fails: bool) -> ApiGateway {
        let bus = Arc::new(MockMessageBus {
            should_fail: bus_fails,
        });
        let limiter = RateLimiter::new(60, Duration::from_secs(60));
        ApiGateway::new(test_secret(), limiter, bus)
    }

    fn make_valid_claims(sub: &str) -> JwtClaims {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        JwtClaims {
            sub: sub.to_string(),
            role: Role::Public,
            exp: now + 3600, // 1 hour from now
            iat: now,
        }
    }

    fn make_expired_claims(sub: &str) -> JwtClaims {
        JwtClaims {
            sub: sub.to_string(),
            role: Role::Public,
            exp: 1000, // long expired
            iat: 900,
        }
    }

    // --- JWT Validation Tests ---

    #[test]
    fn test_validate_jwt_valid_token() {
        let gw = make_gateway(false);
        let claims = make_valid_claims("user-1");
        let token = gw.generate_jwt(&claims).unwrap();

        let result = gw.validate_jwt(&token);
        assert!(result.is_ok());
        let decoded = result.unwrap();
        assert_eq!(decoded.sub, "user-1");
        assert_eq!(decoded.role, Role::Public);
    }

    #[test]
    fn test_validate_jwt_expired_token() {
        let gw = make_gateway(false);
        let claims = make_expired_claims("user-2");
        let token = gw.generate_jwt(&claims).unwrap();

        let result = gw.validate_jwt(&token);
        assert_eq!(result, Err(AuthError::ExpiredToken));
    }

    #[test]
    fn test_validate_jwt_malformed_token() {
        let gw = make_gateway(false);

        let result = gw.validate_jwt("not.a.valid.jwt.token");
        assert_eq!(result, Err(AuthError::MalformedToken));
    }

    #[test]
    fn test_validate_jwt_empty_token() {
        let gw = make_gateway(false);

        let result = gw.validate_jwt("");
        assert_eq!(result, Err(AuthError::MissingToken));
    }

    #[test]
    fn test_validate_jwt_wrong_secret() {
        let gw = make_gateway(false);
        let claims = make_valid_claims("user-3");

        // Sign with a different secret
        let wrong_key = EncodingKey::from_secret(b"wrong-secret");
        let token = encode(&Header::default(), &claims, &wrong_key).unwrap();

        let result = gw.validate_jwt(&token);
        assert_eq!(result, Err(AuthError::InvalidSignature));
    }

    #[test]
    fn test_validate_jwt_admin_role() {
        let gw = make_gateway(false);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = JwtClaims {
            sub: "admin-user".to_string(),
            role: Role::Admin,
            exp: now + 3600,
            iat: now,
        };
        let token = gw.generate_jwt(&claims).unwrap();

        let result = gw.validate_jwt(&token);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().role, Role::Admin);
    }

    #[test]
    fn test_validate_jwt_agent_role() {
        let gw = make_gateway(false);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = JwtClaims {
            sub: "picoclaw".to_string(),
            role: Role::Agent(AgentId::new("picoclaw")),
            exp: now + 3600,
            iat: now,
        };
        let token = gw.generate_jwt(&claims).unwrap();

        let result = gw.validate_jwt(&token);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().role,
            Role::Agent(AgentId::new("picoclaw"))
        );
    }

    // --- Rate Limiter Tests ---

    #[test]
    fn test_rate_limiter_allows_within_limit() {
        let mut limiter = RateLimiter::new(60, Duration::from_secs(60));
        let now = 1_000_000u64;

        for i in 0..60 {
            let result = limiter.check("client-1", now + i * 100);
            assert!(result.is_ok(), "Request {} should be allowed", i);
        }
    }

    #[test]
    fn test_rate_limiter_rejects_over_limit() {
        let mut limiter = RateLimiter::new(60, Duration::from_secs(60));
        let now = 1_000_000u64;

        // Fill up the limit
        for i in 0..60 {
            limiter.check("client-1", now + i * 100).unwrap();
        }

        // 61st request should be rejected
        let result = limiter.check("client-1", now + 6000);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.retry_after_secs > 0);
    }

    #[test]
    fn test_rate_limiter_window_slides() {
        let mut limiter = RateLimiter::new(60, Duration::from_secs(60));
        let now = 1_000_000u64;

        // Fill up the limit at time `now`
        for i in 0..60 {
            limiter.check("client-1", now + i * 10).unwrap();
        }

        // After the window passes, requests should be allowed again
        let future = now + 61_000; // 61 seconds later
        let result = limiter.check("client-1", future);
        assert!(result.is_ok());
    }

    #[test]
    fn test_rate_limiter_independent_clients() {
        let mut limiter = RateLimiter::new(60, Duration::from_secs(60));
        let now = 1_000_000u64;

        // Fill up client-1
        for i in 0..60 {
            limiter.check("client-1", now + i * 100).unwrap();
        }

        // client-2 should still be allowed
        let result = limiter.check("client-2", now);
        assert!(result.is_ok());
    }

    #[test]
    fn test_rate_limiter_current_count() {
        let mut limiter = RateLimiter::new(60, Duration::from_secs(60));
        let now = 1_000_000u64;

        assert_eq!(limiter.current_count("client-1", now), 0);

        for i in 0..10 {
            limiter.check("client-1", now + i * 100).unwrap();
        }

        assert_eq!(limiter.current_count("client-1", now + 1000), 10);
    }

    // --- handle_request Tests ---

    #[tokio::test]
    async fn test_handle_request_missing_token() {
        let gw = make_gateway(false);

        let result = gw
            .handle_request(None, b"hello".to_vec(), "conversation".to_string())
            .await;

        assert!(matches!(result, Err(GatewayError::Auth(AuthError::MissingToken))));
    }

    #[tokio::test]
    async fn test_handle_request_invalid_token() {
        let gw = make_gateway(false);

        let result = gw
            .handle_request(
                Some("invalid-token"),
                b"hello".to_vec(),
                "conversation".to_string(),
            )
            .await;

        assert!(matches!(result, Err(GatewayError::Auth(_))));
    }

    #[tokio::test]
    async fn test_handle_request_valid_token_publishes() {
        let gw = make_gateway(false);
        let claims = make_valid_claims("user-1");
        let token = gw.generate_jwt(&claims).unwrap();

        let result = gw
            .handle_request(
                Some(&token),
                b"hello".to_vec(),
                "conversation".to_string(),
            )
            .await;

        assert!(result.is_ok());
        assert!(result.unwrap().starts_with("msg-"));
    }

    #[tokio::test]
    async fn test_handle_request_bus_failure() {
        let gw = make_gateway(true); // bus will fail
        let claims = make_valid_claims("user-1");
        let token = gw.generate_jwt(&claims).unwrap();

        let result = gw
            .handle_request(
                Some(&token),
                b"hello".to_vec(),
                "conversation".to_string(),
            )
            .await;

        assert!(matches!(result, Err(GatewayError::BusPublishFailed(_))));
    }

    #[tokio::test]
    async fn test_handle_request_rate_limited() {
        let bus = Arc::new(MockMessageBus { should_fail: false });
        let limiter = RateLimiter::new(2, Duration::from_secs(60)); // low limit for testing
        let gw = ApiGateway::new(test_secret(), limiter, bus);

        let claims = make_valid_claims("user-rate");
        let token = gw.generate_jwt(&claims).unwrap();

        // First two requests succeed
        gw.handle_request(Some(&token), b"1".to_vec(), "action".to_string())
            .await
            .unwrap();
        gw.handle_request(Some(&token), b"2".to_vec(), "action".to_string())
            .await
            .unwrap();

        // Third request should be rate limited
        let result = gw
            .handle_request(Some(&token), b"3".to_vec(), "action".to_string())
            .await;

        assert!(matches!(result, Err(GatewayError::RateLimit(_))));
    }

    // --- gRPC Service Tests ---

    #[tokio::test]
    async fn test_grpc_submit_task_valid() {
        let gw = Arc::new(make_gateway(false));
        let service = grpc::GatewayGrpcService::new(gw.clone());

        let claims = make_valid_claims("grpc-user");
        let token = gw.generate_jwt(&claims).unwrap();

        let request = grpc::SubmitTaskRequest {
            token,
            task_type: "analysis".to_string(),
            payload: b"analyze this".to_vec(),
        };

        let result = service.submit_task(request).await;
        assert!(result.is_ok());
        assert!(!result.unwrap().message_id.is_empty());
    }

    #[tokio::test]
    async fn test_grpc_submit_task_no_token() {
        let gw = Arc::new(make_gateway(false));
        let service = grpc::GatewayGrpcService::new(gw);

        let request = grpc::SubmitTaskRequest {
            token: String::new(),
            task_type: "action".to_string(),
            payload: b"do something".to_vec(),
        };

        let result = service.submit_task(request).await;
        assert!(matches!(result, Err(GatewayError::Auth(AuthError::MissingToken))));
    }

    #[tokio::test]
    async fn test_grpc_health() {
        let gw = Arc::new(make_gateway(false));
        let service = grpc::GatewayGrpcService::new(gw);

        let response = service.health().await;
        assert_eq!(response.status, "healthy");
    }
}
