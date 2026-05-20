-- Migration: 002_create_leads
-- Description: Create leads table for CalangoBot lead capture
-- Requirements: 14.5, 15.3

CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    contact VARCHAR(255) NOT NULL,
    interest TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    conversation_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for filtering and sorting
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
