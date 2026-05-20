/**
 * ConfigPanel — Runtime configuration panel for CalangoFlux Agentic OS
 *
 * Allows the admin to configure:
 * - Rate limits per agent
 * - Health check intervals
 * - Agent enable/disable
 *
 * Calls PUT /config endpoint to update Supabase agent_config without redeployment.
 * Requirements: 14.6
 */

import { useState, useEffect, useCallback } from 'react';

// --- Types ---

export interface AgentConfig {
  agentId: string;
  enabled: boolean;
  rateLimitPerMinute: number;
  healthCheckIntervalSeconds: number;
  maxMemoryMb: number;
  maxCpuMillicores: number;
  metadata: Record<string, unknown> | null;
  updatedAt: string;
}

export interface ConfigUpdate {
  rateLimits?: { agentId: string; maxPerMinute: number }[];
  healthCheckInterval?: number;
  agentEnabled?: { agentId: string; enabled: boolean }[];
}

interface ConfigPanelProps {
  apiBaseUrl?: string;
  authToken?: string;
}

// --- API helpers ---

async function fetchAgentConfigs(
  baseUrl: string,
  token: string
): Promise<AgentConfig[]> {
  const res = await fetch(`${baseUrl}/api/admin/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch config: ${res.status}`);
  }
  return res.json() as Promise<AgentConfig[]>;
}

async function updateConfig(
  baseUrl: string,
  token: string,
  update: ConfigUpdate
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/admin/config`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    throw new Error(`Failed to update config: ${res.status}`);
  }
}

// --- Component ---

export function ConfigPanel({ apiBaseUrl = '', authToken = '' }: ConfigPanelProps) {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Local editable state (mirrors configs for editing)
  const [editedConfigs, setEditedConfigs] = useState<AgentConfig[]>([]);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAgentConfigs(apiBaseUrl, authToken);
      setConfigs(data);
      setEditedConfigs(data.map((c) => ({ ...c })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const handleRateLimitChange = (agentId: string, value: number) => {
    setEditedConfigs((prev) =>
      prev.map((c) =>
        c.agentId === agentId ? { ...c, rateLimitPerMinute: value } : c
      )
    );
  };

  const handleHealthCheckChange = (agentId: string, value: number) => {
    setEditedConfigs((prev) =>
      prev.map((c) =>
        c.agentId === agentId ? { ...c, healthCheckIntervalSeconds: value } : c
      )
    );
  };

  const handleEnabledToggle = (agentId: string) => {
    setEditedConfigs((prev) =>
      prev.map((c) =>
        c.agentId === agentId ? { ...c, enabled: !c.enabled } : c
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Build the ConfigUpdate payload from diffs
      const rateLimits: ConfigUpdate['rateLimits'] = [];
      const agentEnabled: ConfigUpdate['agentEnabled'] = [];
      let healthCheckInterval: number | undefined;

      for (const edited of editedConfigs) {
        const original = configs.find((c) => c.agentId === edited.agentId);
        if (!original) continue;

        if (edited.rateLimitPerMinute !== original.rateLimitPerMinute) {
          rateLimits.push({
            agentId: edited.agentId,
            maxPerMinute: edited.rateLimitPerMinute,
          });
        }

        if (edited.enabled !== original.enabled) {
          agentEnabled.push({
            agentId: edited.agentId,
            enabled: edited.enabled,
          });
        }

        if (edited.healthCheckIntervalSeconds !== original.healthCheckIntervalSeconds) {
          // Use the last changed value as the global health check interval
          healthCheckInterval = edited.healthCheckIntervalSeconds;
        }
      }

      const update: ConfigUpdate = {};
      if (rateLimits.length > 0) update.rateLimits = rateLimits;
      if (agentEnabled.length > 0) update.agentEnabled = agentEnabled;
      if (healthCheckInterval !== undefined) update.healthCheckInterval = healthCheckInterval;

      await updateConfig(apiBaseUrl, authToken, update);
      setSuccessMessage('Configuration updated successfully');
      // Reload to reflect server state
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(configs) !== JSON.stringify(editedConfigs);

  if (loading) {
    return <div className="config-panel" aria-busy="true">Loading configuration...</div>;
  }

  return (
    <div className="config-panel">
      <h2>Runtime Configuration</h2>

      {error && (
        <div className="config-panel__error" role="alert">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="config-panel__success" role="status">
          {successMessage}
        </div>
      )}

      <table className="config-panel__table" aria-label="Agent configuration">
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Enabled</th>
            <th scope="col">Rate Limit (req/min)</th>
            <th scope="col">Health Check Interval (s)</th>
            <th scope="col">Last Updated</th>
          </tr>
        </thead>
        <tbody>
          {editedConfigs.map((config) => (
            <tr key={config.agentId}>
              <td>{config.agentId}</td>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={() => handleEnabledToggle(config.agentId)}
                    aria-label={`Enable ${config.agentId}`}
                  />
                  {config.enabled ? 'Active' : 'Disabled'}
                </label>
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={config.rateLimitPerMinute}
                  onChange={(e) =>
                    handleRateLimitChange(config.agentId, Number(e.target.value))
                  }
                  aria-label={`Rate limit for ${config.agentId}`}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={config.healthCheckIntervalSeconds}
                  onChange={(e) =>
                    handleHealthCheckChange(config.agentId, Number(e.target.value))
                  }
                  aria-label={`Health check interval for ${config.agentId}`}
                />
              </td>
              <td>{new Date(config.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="config-panel__actions">
        <button
          onClick={() => void handleSave()}
          disabled={saving || !hasChanges}
          aria-label="Save configuration changes"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={() => void loadConfigs()}
          disabled={loading}
          aria-label="Reload configuration"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export default ConfigPanel;
