-- Seed Data: Initial agent configurations and access control matrix
-- Description: Populates agent_config and access_control_matrix with default values
-- for the CalangoFlux Agentic OS platform agents.

-- ============================================================
-- Agent Configurations
-- ============================================================

INSERT INTO agent_config (agent_id, enabled, rate_limit_per_minute, health_check_interval_seconds, max_memory_mb, max_cpu_millicores, metadata, updated_at)
VALUES
    -- IronClaw: Agent OS Runtime (Rust) — higher resources as it manages sandboxes
    ('ironclaw', TRUE, 200, 30, 512, 1000, '{"description": "Agent OS Runtime — WASM sandboxing, credential vault, API gateway, message bus, agent registry", "language": "rust"}', NOW()),

    -- PicoClaw: Ultra-lightweight router (Go) — minimal resources by design
    ('picoclaw', TRUE, 500, 30, 10, 200, '{"description": "Ultra-lightweight task router/orchestrator (<10MB RAM, <1s startup)", "language": "go"}', NOW()),

    -- OpenClaw: Action executor (TypeScript) — moderate resources for external API calls
    ('openclaw', TRUE, 100, 30, 256, 500, '{"description": "External action executor with 20+ tool integrations", "language": "typescript"}', NOW()),

    -- CalangoVallum: Security module (Rust) — always-on, moderate resources
    ('calango-vallum', TRUE, 300, 15, 256, 500, '{"description": "Security module — SHIELD, SPEAR, CHAIN, HEALER agents", "language": "rust"}', NOW()),

    -- Gemini 4: Reasoning engine (via Google AI API) — rate-limited by API quotas
    ('gemini-4', TRUE, 15, 60, 128, 250, '{"description": "Reasoning engine for conversations, analysis, and auto-correction (Google AI Studio)", "language": "api", "rate_limit_note": "Google AI Studio free tier: 15 req/min, 1000 req/day"}', NOW());

-- ============================================================
-- Access Control Matrix
-- Standard communication paths for the CalangoFlux Agentic OS
-- ============================================================

-- IronClaw (API Gateway) can send to PicoClaw (routing)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('ironclaw', 'picoclaw', TRUE, NOW(), NOW());

-- PicoClaw can route tasks to OpenClaw (actions)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('picoclaw', 'openclaw', TRUE, NOW(), NOW());

-- PicoClaw can route tasks to Gemini 4 (conversations/analysis)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('picoclaw', 'gemini-4', TRUE, NOW(), NOW());

-- OpenClaw can send results back to IronClaw (response delivery)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('openclaw', 'ironclaw', TRUE, NOW(), NOW());

-- Gemini 4 can send results back to IronClaw (response delivery)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('gemini-4', 'ironclaw', TRUE, NOW(), NOW());

-- CalangoVallum can observe/send to all agents (security monitoring)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('calango-vallum', 'ironclaw', TRUE, NOW(), NOW());

INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('calango-vallum', 'picoclaw', TRUE, NOW(), NOW());

INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('calango-vallum', 'openclaw', TRUE, NOW(), NOW());

INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('calango-vallum', 'gemini-4', TRUE, NOW(), NOW());

-- IronClaw can notify CalangoVallum (agent lifecycle events, health alerts)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('ironclaw', 'calango-vallum', TRUE, NOW(), NOW());

-- OpenClaw can request credentials from IronClaw (credential vault access)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('openclaw', 'calango-vallum', TRUE, NOW(), NOW());

-- PicoClaw can notify CalangoVallum (routing anomalies)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('picoclaw', 'calango-vallum', TRUE, NOW(), NOW());

-- Gemini 4 can send to CalangoVallum (HEALER diagnosis results)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('gemini-4', 'calango-vallum', TRUE, NOW(), NOW());

-- IronClaw can send to OpenClaw (credential tokens for action execution)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('ironclaw', 'openclaw', TRUE, NOW(), NOW());

-- IronClaw can send to Gemini 4 (direct requests from API Gateway)
INSERT INTO access_control_matrix (source_agent, destination_agent, allowed, created_at, updated_at)
VALUES ('ironclaw', 'gemini-4', TRUE, NOW(), NOW());
