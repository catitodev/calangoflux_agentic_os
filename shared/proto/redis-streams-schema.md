# Redis Streams Message Schema

Canonical message format for all Redis Streams used in CalangoFlux Agentic OS.
All services (Rust, Go, TypeScript) MUST use these exact field names when
reading from or writing to Redis Streams.

## Stream Keys

| Stream Pattern | Purpose | Example |
|---|---|---|
| `tasks:{agent_id}` | Task delivery to a specific agent | `tasks:picoclaw` |
| `responses:{request_id}` | Response for a specific request | `responses:req-abc123` |
| `health:{agent_id}` | Health check reports | `health:openclaw` |
| `alerts:security` | Security alerts from SHIELD | `alerts:security` |

## Consumer Groups

| Group Name | Stream | Service |
|---|---|---|
| `picoclaw-workers` | `tasks:router` | PicoClaw |
| `openclaw-workers` | `tasks:action` | OpenClaw |
| `shield-observers` | `tasks:*` (fan-out) | CalangoVallum SHIELD |

## Task Message Fields

Published via `XADD tasks:{agent_id} * ...`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique message UUID (v4) |
| `sender_id` | string | yes | Agent ID of the sender |
| `destination_id` | string | yes | Agent ID of the recipient |
| `task_type` | string | yes | Intent category: conversation, research, action, analysis, internal |
| `payload` | string | yes | Base64-encoded payload bytes |
| `timestamp` | string | yes | Unix timestamp in milliseconds |
| `priority` | string | no | Priority level (0 = normal, higher = more urgent) |

### Validation Rules (Requirement 4.5)

A message MUST be rejected if any of the following are true:
- `sender_id` is empty or missing
- `destination_id` is empty or missing
- `payload` is empty or missing

## Response Message Fields

Published via `XADD responses:{request_id} * ...`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique response UUID |
| `agent_id` | string | yes | Agent that produced the response |
| `status` | string | yes | "success" or "failure" |
| `output` | string | yes | Base64-encoded output payload |
| `duration` | string | yes | Execution duration in milliseconds |
| `timestamp` | string | yes | Unix timestamp in milliseconds |

## Health Check Fields

Published via `XADD health:{agent_id} * ...`

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | yes | "healthy", "degraded", or "dead" |
| `cpu` | string | yes | CPU usage percentage (0-100) |
| `memory` | string | yes | Memory usage in bytes |
| `timestamp` | string | yes | Unix timestamp in milliseconds |

## Security Alert Fields

Published via `XADD alerts:security * ...`

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | Alert type: "credential_exposure", "rate_limit", "anomaly", "access_violation" |
| `agent_id` | string | yes | Agent that triggered the alert |
| `severity` | string | yes | "low", "medium", "high", "critical" |
| `details` | string | yes | JSON-encoded alert details |
| `timestamp` | string | yes | Unix timestamp in milliseconds |

## Notes

- All field values in Redis Streams are strings. Numeric values are string-encoded.
- Payloads are Base64-encoded to safely transmit binary data as Redis string values.
- Consumer groups provide at-least-once delivery semantics with acknowledgment.
- Messages are retained until explicitly trimmed (MAXLEN or MINID).
