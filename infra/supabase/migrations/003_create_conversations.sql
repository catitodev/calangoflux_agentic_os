-- Migration: 003_create_conversations
-- Description: Create conversations table for chat history persistence
-- Requirements: 15.3

CREATE TABLE conversations (
    id VARCHAR(64) PRIMARY KEY,
    lead_id UUID REFERENCES leads(id),
    messages JSONB NOT NULL DEFAULT '[]',
    context_window INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
