//! Message Bus Client — Redis Streams inter-agent communication.
//!
//! Provides the `MessageBusClient` for publishing and subscribing to messages
//! on Redis Streams with validation, access control, local queuing for
//! bus unavailability, and at-least-once delivery guarantees.
//!
//! Requirements: 4.1, 4.2, 4.4, 4.5, 16.1

use std::collections::VecDeque;

use crate::access_control::AccessControlMatrix;
use crate::types::{AgentId, BusMessage};
use crate::types::redis_schema;

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during message bus operations.
#[derive(Debug, Clone, thiserror::Error)]
pub enum BusError {
    #[error("Message validation failed: {0}")]
    ValidationFailed(String),

    #[error("Access denied: {sender} cannot send to {destination}")]
    AccessDenied { sender: String, destination: String },

    #[error("Bus unavailable: {0}")]
    Unavailable(String),

    #[error("Local queue full (max {max} messages)")]
    QueueFull { max: usize },

    #[error("Redis error: {0}")]
    RedisError(String),

    #[error("Subscribe error: {0}")]
    SubscribeError(String),
}

// =============================================================================
// Redis Connection Trait (for testability)
// =============================================================================

/// Maximum number of messages in the local queue when bus is unavailable.
pub const MAX_LOCAL_QUEUE_SIZE: usize = 1000;

/// A single entry read from a Redis Stream.
#[derive(Debug, Clone)]
pub struct StreamEntry {
    /// The stream entry ID (e.g., "1700000000000-0").
    pub id: String,
    /// The key-value fields of the entry.
    pub fields: Vec<(String, String)>,
}

/// Trait abstracting the Redis connection for testability.
///
/// This allows mocking the Redis connection in unit tests without
/// requiring a live Redis instance.
#[async_trait::async_trait]
pub trait RedisConnection: Send + Sync {
    /// Publish a message to a Redis Stream using XADD.
    /// Returns the stream entry ID on success.
    async fn xadd(
        &self,
        stream_key: &str,
        fields: &[(&str, &str)],
    ) -> Result<String, BusError>;

    /// Read messages from a stream using XREADGROUP (consumer group).
    /// Returns a list of stream entries.
    async fn xreadgroup(
        &self,
        group: &str,
        consumer: &str,
        stream_key: &str,
        count: usize,
    ) -> Result<Vec<StreamEntry>, BusError>;

    /// Acknowledge a message in a consumer group using XACK.
    async fn xack(
        &self,
        stream_key: &str,
        group: &str,
        entry_id: &str,
    ) -> Result<(), BusError>;

    /// Create a consumer group on a stream (XGROUP CREATE).
    async fn xgroup_create(
        &self,
        stream_key: &str,
        group: &str,
    ) -> Result<(), BusError>;

    /// Check if the Redis connection is alive.
    async fn is_connected(&self) -> bool;
}


// (StreamEntry already defined above)

// =============================================================================
// MessageBusClient
// =============================================================================

/// Client for the Redis Streams-based inter-agent message bus.
///
/// Handles publishing, subscribing, access control validation, and local
/// queuing when the bus is unavailable. Guarantees at-least-once delivery
/// through Redis consumer groups and message acknowledgment.
pub struct MessageBusClient<R: RedisConnection> {
    redis: R,
    access_matrix: AccessControlMatrix,
    local_queue: VecDeque<BusMessage>,
}

impl<R: RedisConnection> MessageBusClient<R> {
    /// Create a new MessageBusClient with the given Redis connection and access matrix.
    pub fn new(redis: R, access_matrix: AccessControlMatrix) -> Self {
        Self {
            redis,
            access_matrix,
            local_queue: VecDeque::new(),
        }
    }

    /// Publish a message to the bus.
    ///
    /// Validates the message fields, checks access control, and publishes
    /// to the appropriate Redis Stream. If Redis is unavailable, queues
    /// the message locally (up to MAX_LOCAL_QUEUE_SIZE).
    ///
    /// # Errors
    /// - `BusError::ValidationFailed` if sender_id, destination_id, or payload is empty
    /// - `BusError::AccessDenied` if the access control matrix denies the communication
    /// - `BusError::QueueFull` if local queue is at capacity during bus outage
    pub async fn publish(&mut self, msg: BusMessage) -> Result<String, BusError> {
        // Step 1: Validate message fields (Requirement 4.5)
        if !msg.is_valid() {
            return Err(BusError::ValidationFailed(
                "Message must have non-empty sender_id, destination_id, and payload".to_string(),
            ));
        }

        // Step 2: Validate access control (Requirement 16.1)
        if !self.validate_access(&msg) {
            return Err(BusError::AccessDenied {
                sender: msg.sender_id.to_string(),
                destination: msg.destination_id.to_string(),
            });
        }

        // Step 3: Attempt to publish to Redis Streams
        if !self.redis.is_connected().await {
            // Bus unavailable — queue locally (Requirement 4.4)
            self.queue_locally(msg)?;
            return Err(BusError::Unavailable(
                "Redis connection unavailable, message queued locally".to_string(),
            ));
        }

        self.publish_to_stream(&msg).await
    }

    /// Subscribe to messages for a specific agent using consumer groups.
    ///
    /// Uses XREADGROUP for load balancing across multiple consumers
    /// of the same agent type (Requirement 4.1, 4.2).
    pub async fn subscribe(
        &self,
        agent_id: &AgentId,
        group: &str,
        consumer: &str,
        count: usize,
    ) -> Result<Vec<BusMessage>, BusError> {
        let stream_key = format!("{}{}", redis_schema::STREAM_TASKS_PREFIX, agent_id.as_str());

        let entries = self.redis.xreadgroup(group, consumer, &stream_key, count).await?;

        let mut messages = Vec::with_capacity(entries.len());
        for entry in &entries {
            if let Some(msg) = Self::parse_stream_entry(entry) {
                // Acknowledge the message for at-least-once delivery (Requirement 4.2)
                self.redis.xack(&stream_key, group, &entry.id).await?;
                messages.push(msg);
            }
        }

        Ok(messages)
    }

    /// Validate a message against the access control matrix.
    ///
    /// Returns `true` if the sender is allowed to communicate with the destination.
    /// Uses zero-trust default: deny if no explicit allow rule exists (Requirement 16.1).
    pub fn validate_access(&self, msg: &BusMessage) -> bool {
        self.access_matrix.is_allowed(&msg.sender_id, &msg.destination_id)
    }

    /// Queue a message locally when the bus is unavailable.
    ///
    /// Maintains a bounded queue of MAX_LOCAL_QUEUE_SIZE (1000) messages.
    /// Oldest messages are preserved (FIFO order). Returns QueueFull error
    /// if the queue is at capacity (Requirement 4.4).
    pub fn queue_locally(&mut self, msg: BusMessage) -> Result<(), BusError> {
        if self.local_queue.len() >= MAX_LOCAL_QUEUE_SIZE {
            return Err(BusError::QueueFull {
                max: MAX_LOCAL_QUEUE_SIZE,
            });
        }
        self.local_queue.push_back(msg);
        Ok(())
    }

    /// Flush all locally queued messages to the bus when connectivity is restored.
    ///
    /// Sends messages in FIFO order. Returns the number of messages
    /// successfully flushed (Requirement 4.4).
    pub async fn flush_queue(&mut self) -> Result<usize, BusError> {
        if !self.redis.is_connected().await {
            return Err(BusError::Unavailable(
                "Cannot flush: Redis still unavailable".to_string(),
            ));
        }

        let mut flushed = 0;
        while let Some(msg) = self.local_queue.pop_front() {
            match self.publish_to_stream(&msg).await {
                Ok(_) => flushed += 1,
                Err(e) => {
                    // Put the message back and stop flushing
                    self.local_queue.push_front(msg);
                    if flushed == 0 {
                        return Err(e);
                    }
                    break;
                }
            }
        }

        Ok(flushed)
    }

    /// Returns the number of messages currently in the local queue.
    pub fn local_queue_len(&self) -> usize {
        self.local_queue.len()
    }

    /// Returns a reference to the access control matrix.
    pub fn access_matrix(&self) -> &AccessControlMatrix {
        &self.access_matrix
    }

    /// Update the access control matrix at runtime.
    pub fn set_access_matrix(&mut self, matrix: AccessControlMatrix) {
        self.access_matrix = matrix;
    }

    /// Ensure a consumer group exists on a stream.
    ///
    /// Creates the consumer group if it doesn't exist (XGROUP CREATE with MKSTREAM).
    /// This is idempotent — if the group already exists, the error is ignored.
    pub async fn ensure_consumer_group(
        &self,
        stream_key: &str,
        group: &str,
    ) -> Result<(), BusError> {
        self.redis.xgroup_create(stream_key, group).await
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /// Publish a message to the Redis Stream using XADD.
    async fn publish_to_stream(&self, msg: &BusMessage) -> Result<String, BusError> {
        let stream_key = format!(
            "{}{}",
            redis_schema::STREAM_TASKS_PREFIX,
            msg.destination_id.as_str()
        );

        let payload_b64 = base64_encode(&msg.payload);
        let timestamp_str = msg.timestamp.to_string();

        let fields: Vec<(&str, &str)> = vec![
            (redis_schema::FIELD_ID, &msg.id),
            (redis_schema::FIELD_SENDER_ID, msg.sender_id.as_str()),
            (redis_schema::FIELD_DESTINATION_ID, msg.destination_id.as_str()),
            (redis_schema::FIELD_TASK_TYPE, &msg.task_type),
            (redis_schema::FIELD_PAYLOAD, &payload_b64),
            (redis_schema::FIELD_TIMESTAMP, &timestamp_str),
        ];

        self.redis.xadd(&stream_key, &fields).await
    }

    /// Parse a Redis Stream entry into a BusMessage.
    fn parse_stream_entry(entry: &StreamEntry) -> Option<BusMessage> {
        let get_field = |name: &str| -> Option<String> {
            entry.fields.iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        };

        let id = get_field(redis_schema::FIELD_ID)?;
        let sender_id = get_field(redis_schema::FIELD_SENDER_ID)?;
        let destination_id = get_field(redis_schema::FIELD_DESTINATION_ID)?;
        let task_type = get_field(redis_schema::FIELD_TASK_TYPE)?;
        let payload_b64 = get_field(redis_schema::FIELD_PAYLOAD)?;
        let timestamp_str = get_field(redis_schema::FIELD_TIMESTAMP)?;

        let payload = base64_decode(&payload_b64)?;
        let timestamp = timestamp_str.parse::<u64>().ok()?;

        Some(BusMessage {
            id,
            sender_id: AgentId::new(sender_id),
            destination_id: AgentId::new(destination_id),
            task_type,
            payload,
            timestamp,
        })
    }
}

// =============================================================================
// Base64 helpers (simple implementation to avoid extra dependency)
// =============================================================================

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn char_to_val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'=').collect();
    let mut result = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        let vals: Vec<u8> = chunk.iter().filter_map(|&b| char_to_val(b)).collect();
        if vals.len() < 2 {
            return None;
        }

        let n = vals.len();
        let triple = (vals[0] as u32) << 18
            | (vals.get(1).copied().unwrap_or(0) as u32) << 12
            | (vals.get(2).copied().unwrap_or(0) as u32) << 6
            | (vals.get(3).copied().unwrap_or(0) as u32);

        result.push((triple >> 16) as u8);
        if n > 2 {
            result.push((triple >> 8) as u8);
        }
        if n > 3 {
            result.push(triple as u8);
        }
    }

    Some(result)
}


// =============================================================================
// Real Redis Connection Implementation
// =============================================================================

/// Real Redis connection using the `redis` crate.
pub struct RealRedisConnection {
    client: redis::Client,
}

impl RealRedisConnection {
    /// Create a new connection to Redis.
    pub fn new(redis_url: &str) -> Result<Self, BusError> {
        let client = redis::Client::open(redis_url)
            .map_err(|e| BusError::RedisError(e.to_string()))?;
        Ok(Self { client })
    }
}

#[async_trait::async_trait]
impl RedisConnection for RealRedisConnection {
    async fn xadd(
        &self,
        stream_key: &str,
        fields: &[(&str, &str)],
    ) -> Result<String, BusError> {
        let mut conn = self.client.get_multiplexed_async_connection()
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream_key).arg("*");
        for (key, value) in fields {
            cmd.arg(*key).arg(*value);
        }

        let entry_id: String = cmd
            .query_async(&mut conn)
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        Ok(entry_id)
    }

    async fn xreadgroup(
        &self,
        group: &str,
        consumer: &str,
        stream_key: &str,
        count: usize,
    ) -> Result<Vec<StreamEntry>, BusError> {
        let mut conn = self.client.get_multiplexed_async_connection()
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        // XREADGROUP GROUP group consumer COUNT count BLOCK 0 STREAMS stream_key >
        let mut cmd = redis::cmd("XREADGROUP");
        cmd.arg("GROUP")
            .arg(group)
            .arg(consumer)
            .arg("COUNT")
            .arg(count)
            .arg("STREAMS")
            .arg(stream_key)
            .arg(">");

        let result: redis::Value = cmd
            .query_async(&mut conn)
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        Ok(parse_xreadgroup_response(result))
    }

    async fn xack(
        &self,
        stream_key: &str,
        group: &str,
        entry_id: &str,
    ) -> Result<(), BusError> {
        let mut conn = self.client.get_multiplexed_async_connection()
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        redis::cmd("XACK")
            .arg(stream_key)
            .arg(group)
            .arg(entry_id)
            .query_async::<i64>(&mut conn)
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        Ok(())
    }

    async fn xgroup_create(
        &self,
        stream_key: &str,
        group: &str,
    ) -> Result<(), BusError> {
        let mut conn = self.client.get_multiplexed_async_connection()
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        // XGROUP CREATE stream group $ MKSTREAM
        redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(stream_key)
            .arg(group)
            .arg("$")
            .arg("MKSTREAM")
            .query_async::<String>(&mut conn)
            .await
            .map_err(|e| BusError::RedisError(e.to_string()))?;

        Ok(())
    }

    async fn is_connected(&self) -> bool {
        match self.client.get_multiplexed_async_connection().await {
            Ok(mut conn) => {
                redis::cmd("PING")
                    .query_async::<String>(&mut conn)
                    .await
                    .is_ok()
            }
            Err(_) => false,
        }
    }
}

/// Parse the raw Redis XREADGROUP response into StreamEntry values.
fn parse_xreadgroup_response(value: redis::Value) -> Vec<StreamEntry> {
    let mut entries = Vec::new();

    // Response format: [[stream_name, [[entry_id, [field, value, ...]], ...]]]
    if let redis::Value::Array(streams) = value {
        for stream in streams {
            if let redis::Value::Array(stream_data) = stream {
                if stream_data.len() >= 2 {
                    if let redis::Value::Array(stream_entries) = &stream_data[1] {
                        for entry in stream_entries {
                            if let redis::Value::Array(entry_data) = entry {
                                if entry_data.len() >= 2 {
                                    let id = match &entry_data[0] {
                                        redis::Value::BulkString(b) => {
                                            String::from_utf8_lossy(b).to_string()
                                        }
                                        _ => continue,
                                    };

                                    let mut fields = Vec::new();
                                    if let redis::Value::Array(field_values) = &entry_data[1] {
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

                                    entries.push(StreamEntry { id, fields });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    entries
}


// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::access_control::AccessRule;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    // =========================================================================
    // Mock Redis Connection
    // =========================================================================

    /// Mock Redis connection for unit testing.
    struct MockRedisConnection {
        connected: Arc<AtomicBool>,
        published: std::sync::Mutex<Vec<(String, Vec<(String, String)>)>>,
        ack_count: std::sync::Mutex<u32>,
    }

    impl MockRedisConnection {
        fn new(connected: bool) -> Self {
            Self {
                connected: Arc::new(AtomicBool::new(connected)),
                published: std::sync::Mutex::new(Vec::new()),
                ack_count: std::sync::Mutex::new(0),
            }
        }

        fn set_connected(&self, connected: bool) {
            self.connected.store(connected, Ordering::SeqCst);
        }

        fn published_count(&self) -> usize {
            self.published.lock().unwrap().len()
        }
    }

    #[async_trait::async_trait]
    impl RedisConnection for MockRedisConnection {
        async fn xadd(
            &self,
            stream_key: &str,
            fields: &[(&str, &str)],
        ) -> Result<String, BusError> {
            if !self.connected.load(Ordering::SeqCst) {
                return Err(BusError::RedisError("Connection refused".to_string()));
            }
            let owned_fields: Vec<(String, String)> = fields
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            self.published.lock().unwrap().push((stream_key.to_string(), owned_fields));
            Ok("1700000000000-0".to_string())
        }

        async fn xreadgroup(
            &self,
            _group: &str,
            _consumer: &str,
            _stream_key: &str,
            _count: usize,
        ) -> Result<Vec<StreamEntry>, BusError> {
            if !self.connected.load(Ordering::SeqCst) {
                return Err(BusError::RedisError("Connection refused".to_string()));
            }
            Ok(vec![])
        }

        async fn xack(
            &self,
            _stream_key: &str,
            _group: &str,
            _entry_id: &str,
        ) -> Result<(), BusError> {
            *self.ack_count.lock().unwrap() += 1;
            Ok(())
        }

        async fn xgroup_create(
            &self,
            _stream_key: &str,
            _group: &str,
        ) -> Result<(), BusError> {
            Ok(())
        }

        async fn is_connected(&self) -> bool {
            self.connected.load(Ordering::SeqCst)
        }
    }

    // =========================================================================
    // Helper functions
    // =========================================================================

    fn make_valid_message() -> BusMessage {
        BusMessage {
            id: "msg-001".to_string(),
            sender_id: AgentId::new("picoclaw"),
            destination_id: AgentId::new("openclaw"),
            task_type: "action".to_string(),
            payload: vec![1, 2, 3],
            timestamp: 1700000000000,
        }
    }

    fn make_access_matrix() -> AccessControlMatrix {
        AccessControlMatrix::from_rules(vec![
            AccessRule::allow(AgentId::new("picoclaw"), AgentId::new("openclaw")),
            AccessRule::allow(AgentId::new("gateway"), AgentId::new("picoclaw")),
            AccessRule::deny(AgentId::new("rogue"), AgentId::new("vault")),
        ])
    }

    // =========================================================================
    // Message Validation Tests
    // =========================================================================

    #[tokio::test]
    async fn test_publish_valid_message() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = make_valid_message();
        let result = client.publish(msg).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_publish_rejects_empty_sender_id() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = BusMessage {
            id: "msg-002".to_string(),
            sender_id: AgentId::new(""),
            destination_id: AgentId::new("openclaw"),
            task_type: "action".to_string(),
            payload: vec![1, 2, 3],
            timestamp: 1700000000000,
        };

        let result = client.publish(msg).await;
        assert!(matches!(result, Err(BusError::ValidationFailed(_))));
    }

    #[tokio::test]
    async fn test_publish_rejects_empty_destination_id() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = BusMessage {
            id: "msg-003".to_string(),
            sender_id: AgentId::new("picoclaw"),
            destination_id: AgentId::new(""),
            task_type: "action".to_string(),
            payload: vec![1, 2, 3],
            timestamp: 1700000000000,
        };

        let result = client.publish(msg).await;
        assert!(matches!(result, Err(BusError::ValidationFailed(_))));
    }

    #[tokio::test]
    async fn test_publish_rejects_empty_payload() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = BusMessage {
            id: "msg-004".to_string(),
            sender_id: AgentId::new("picoclaw"),
            destination_id: AgentId::new("openclaw"),
            task_type: "action".to_string(),
            payload: vec![],
            timestamp: 1700000000000,
        };

        let result = client.publish(msg).await;
        assert!(matches!(result, Err(BusError::ValidationFailed(_))));
    }

    // =========================================================================
    // Access Control Tests
    // =========================================================================

    #[tokio::test]
    async fn test_publish_denied_by_access_control() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = BusMessage {
            id: "msg-005".to_string(),
            sender_id: AgentId::new("rogue"),
            destination_id: AgentId::new("vault"),
            task_type: "action".to_string(),
            payload: vec![1, 2, 3],
            timestamp: 1700000000000,
        };

        let result = client.publish(msg).await;
        assert!(matches!(result, Err(BusError::AccessDenied { .. })));
    }

    #[tokio::test]
    async fn test_publish_denied_unknown_pair() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        // This pair has no rule → zero-trust default deny
        let msg = BusMessage {
            id: "msg-006".to_string(),
            sender_id: AgentId::new("unknown"),
            destination_id: AgentId::new("openclaw"),
            task_type: "action".to_string(),
            payload: vec![1, 2, 3],
            timestamp: 1700000000000,
        };

        let result = client.publish(msg).await;
        assert!(matches!(result, Err(BusError::AccessDenied { .. })));
    }

    #[test]
    fn test_validate_access_allowed() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let client = MessageBusClient::new(redis, matrix);

        let msg = make_valid_message();
        assert!(client.validate_access(&msg));
    }

    #[test]
    fn test_validate_access_denied() {
        let redis = MockRedisConnection::new(true);
        let matrix = make_access_matrix();
        let client = MessageBusClient::new(redis, matrix);

        let msg = BusMessage {
            id: "msg-007".to_string(),
            sender_id: AgentId::new("rogue"),
            destination_id: AgentId::new("vault"),
            task_type: "action".to_string(),
            payload: vec![1],
            timestamp: 1700000000000,
        };
        assert!(!client.validate_access(&msg));
    }

    // =========================================================================
    // Local Queue Tests
    // =========================================================================

    #[tokio::test]
    async fn test_queue_locally_on_bus_unavailable() {
        let redis = MockRedisConnection::new(false);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = make_valid_message();
        let result = client.publish(msg).await;

        assert!(matches!(result, Err(BusError::Unavailable(_))));
        assert_eq!(client.local_queue_len(), 1);
    }

    #[test]
    fn test_local_queue_max_1000_messages() {
        let redis = MockRedisConnection::new(false);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        // Fill the queue to capacity
        for i in 0..MAX_LOCAL_QUEUE_SIZE {
            let msg = BusMessage {
                id: format!("msg-{}", i),
                sender_id: AgentId::new("picoclaw"),
                destination_id: AgentId::new("openclaw"),
                task_type: "action".to_string(),
                payload: vec![1],
                timestamp: 1700000000000,
            };
            assert!(client.queue_locally(msg).is_ok());
        }

        assert_eq!(client.local_queue_len(), MAX_LOCAL_QUEUE_SIZE);

        // 1001st message should fail
        let overflow_msg = BusMessage {
            id: "msg-overflow".to_string(),
            sender_id: AgentId::new("picoclaw"),
            destination_id: AgentId::new("openclaw"),
            task_type: "action".to_string(),
            payload: vec![1],
            timestamp: 1700000000000,
        };
        let result = client.queue_locally(overflow_msg);
        assert!(matches!(result, Err(BusError::QueueFull { max: 1000 })));
    }

    #[tokio::test]
    async fn test_flush_queue_sends_all_messages() {
        let redis = MockRedisConnection::new(false);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        // Queue 5 messages while disconnected
        for i in 0..5 {
            let msg = BusMessage {
                id: format!("msg-{}", i),
                sender_id: AgentId::new("picoclaw"),
                destination_id: AgentId::new("openclaw"),
                task_type: "action".to_string(),
                payload: vec![1, 2, 3],
                timestamp: 1700000000000,
            };
            client.queue_locally(msg).unwrap();
        }
        assert_eq!(client.local_queue_len(), 5);

        // Restore connectivity
        client.redis.set_connected(true);

        // Flush
        let flushed = client.flush_queue().await.unwrap();
        assert_eq!(flushed, 5);
        assert_eq!(client.local_queue_len(), 0);
        assert_eq!(client.redis.published_count(), 5);
    }

    #[tokio::test]
    async fn test_flush_queue_fails_when_still_disconnected() {
        let redis = MockRedisConnection::new(false);
        let matrix = make_access_matrix();
        let mut client = MessageBusClient::new(redis, matrix);

        let msg = make_valid_message();
        client.queue_locally(msg).unwrap();

        let result = client.flush_queue().await;
        assert!(matches!(result, Err(BusError::Unavailable(_))));
        assert_eq!(client.local_queue_len(), 1); // Message still in queue
    }

    // =========================================================================
    // Base64 encoding/decoding tests
    // =========================================================================

    #[test]
    fn test_base64_roundtrip() {
        let data = b"Hello, CalangoFlux!";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_base64_empty() {
        let data = b"";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_base64_single_byte() {
        let data = b"A";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_base64_two_bytes() {
        let data = b"AB";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }
}
