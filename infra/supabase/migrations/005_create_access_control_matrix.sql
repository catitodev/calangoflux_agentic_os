-- Migration: 005_create_access_control_matrix
-- Description: Create access_control_matrix table for CalangoVallum zero-trust validation
-- Requirements: 16.2

CREATE TABLE access_control_matrix (
    id SERIAL PRIMARY KEY,
    source_agent VARCHAR(64) NOT NULL,
    destination_agent VARCHAR(64) NOT NULL,
    allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_agent, destination_agent)
);
