-- Migration: 001_create_audit_entries
-- Description: Create audit_entries table for CHAIN Agent immutable audit trail
-- Requirements: 8.1 (SHA-256 hash chain for all events)

CREATE TABLE audit_entries (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor VARCHAR(64) NOT NULL,
    action_type VARCHAR(32) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    previous_hash CHAR(64) NOT NULL,
    entry_hash CHAR(64) NOT NULL UNIQUE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_audit_timestamp ON audit_entries(timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_entries(actor);
CREATE INDEX idx_audit_action ON audit_entries(action_type);
