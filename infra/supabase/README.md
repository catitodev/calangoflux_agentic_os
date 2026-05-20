# Supabase PostgreSQL — CalangoFlux Agentic OS

## Schema Overview

The database schema supports the CalangoFlux Agentic OS platform with five tables:

| Table | Purpose | Used By |
|-------|---------|---------|
| `audit_entries` | Immutable SHA-256 hash chain audit trail | CHAIN Agent (CalangoVallum) |
| `leads` | Lead capture from CalangoBot conversations | CalangoBot, Admin Dashboard |
| `conversations` | Chat history with context window tracking | CalangoBot, Gemini 4 |
| `agent_config` | Runtime-configurable agent settings | Admin Dashboard, Agent Registry |
| `access_control_matrix` | Zero-trust inter-agent communication rules | CalangoVallum (SHIELD) |

## Migrations

Run migrations in order:

```bash
# Using Supabase CLI
supabase db push

# Or manually in order:
psql $DATABASE_URL -f infra/supabase/migrations/001_create_audit_entries.sql
psql $DATABASE_URL -f infra/supabase/migrations/002_create_leads.sql
psql $DATABASE_URL -f infra/supabase/migrations/003_create_conversations.sql
psql $DATABASE_URL -f infra/supabase/migrations/004_create_agent_config.sql
psql $DATABASE_URL -f infra/supabase/migrations/005_create_access_control_matrix.sql
```

## Seed Data

After running migrations, seed the initial data:

```bash
psql $DATABASE_URL -f infra/supabase/seed.sql
```

This populates:
- Agent configurations for: `ironclaw`, `picoclaw`, `openclaw`, `calango-vallum`, `gemini-4`
- Access control matrix with standard communication paths between all agents

## Indexes

- `idx_audit_timestamp` — Efficient time-range queries on audit trail
- `idx_audit_actor` — Filter audit entries by agent
- `idx_audit_action` — Filter audit entries by action type
- `idx_leads_status` — Filter leads by status (new, contacted, converted, lost)
- `idx_leads_created` — Sort leads by creation date (newest first)
