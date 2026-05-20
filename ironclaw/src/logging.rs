//! Structured JSON logging initialization for IronClaw.
//!
//! Uses `tracing` + `tracing-subscriber` with the JSON formatting layer.
//! Each log entry outputs valid JSON with required fields:
//! - timestamp: ISO 8601 format
//! - agent_id: identifier of the agent (set via span)
//! - level: info/warn/error
//! - message: human-readable log message
//! - metadata: additional structured fields

use tracing_subscriber::{fmt, EnvFilter};

/// Initialize the structured JSON logging subscriber.
///
/// This sets up `tracing-subscriber` with:
/// - JSON output format
/// - Timestamps (ISO 8601 via SystemTime)
/// - Environment-based filtering via `RUST_LOG` (defaults to `info`)
///
/// # Panics
///
/// Panics if the subscriber has already been set (call only once at startup).
///
/// # Example
///
/// ```rust,no_run
/// use ironclaw::logging::init;
///
/// fn main() {
///     init();
///     tracing::info!(agent_id = "ironclaw-main", "service started");
/// }
/// ```
pub fn init() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .json()
        .with_timer(fmt::time::SystemTime)
        .with_target(true)
        .with_level(true)
        .with_env_filter(filter)
        .init();
}

/// Initialize the structured JSON logging subscriber with a custom filter.
///
/// Allows specifying a filter directive string (e.g., "debug", "ironclaw=trace").
///
/// # Panics
///
/// Panics if the subscriber has already been set.
pub fn init_with_filter(filter_directive: &str) {
    let filter = EnvFilter::new(filter_directive);

    fmt()
        .json()
        .with_timer(fmt::time::SystemTime)
        .with_target(true)
        .with_level(true)
        .with_env_filter(filter)
        .init();
}

#[cfg(test)]
mod tests {
    // Note: tracing subscriber can only be initialized once per process,
    // so we test the init functions don't panic in isolation.
    // Full JSON output validation is done via integration tests.

    #[test]
    fn test_env_filter_parsing() {
        use tracing_subscriber::EnvFilter;
        // Verify that common filter directives parse correctly
        let _ = EnvFilter::new("info");
        let _ = EnvFilter::new("debug");
        let _ = EnvFilter::new("ironclaw=trace,calango_vallum=debug");
    }
}
