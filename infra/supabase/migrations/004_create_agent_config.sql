-- Migration: 004_create_agent_config
-- Description: Create agent_config table for runtime-configurable agent settings
-- Requirements: 14.5, 16.2

CREATE TABLE agent_config (
    agent_id VARCHAR(64) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    rate_limit_per_minute INT NOT NULL DEFAULT 100,
    health_check_interval_seconds INT NOT NULL DEFAULT 30,
    max_memory_mb INT NOT NULL DEFAULT 128,
    max_cpu_millicores INT NOT NULL DEFAULT 500,
    metadata JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
