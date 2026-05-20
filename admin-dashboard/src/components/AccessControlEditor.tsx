/**
 * AccessControlEditor — Editor for the CalangoVallum access control matrix
 *
 * Allows the admin to:
 * - View all access control rules (source → destination, allowed/denied)
 * - Add new rules
 * - Remove existing rules
 * - Toggle allowed/denied status
 *
 * Calls PUT /config endpoint to update Supabase access_control_matrix without redeployment.
 * Requirements: 16.4
 */

import { useState, useEffect, useCallback } from 'react';

// --- Types ---

export interface AccessRule {
  id: number;
  sourceAgent: string;
  destinationAgent: string;
  allowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessRuleCreate {
  sourceAgent: string;
  destinationAgent: string;
  allowed: boolean;
}

interface AccessControlEditorProps {
  apiBaseUrl?: string;
  authToken?: string;
}

// --- API helpers ---

async function fetchAccessRules(
  baseUrl: string,
  token: string
): Promise<AccessRule[]> {
  const res = await fetch(`${baseUrl}/api/admin/access-control`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch access rules: ${res.status}`);
  }
  return res.json() as Promise<AccessRule[]>;
}

async function addAccessRule(
  baseUrl: string,
  token: string,
  rule: AccessRuleCreate
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/admin/access-control`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    throw new Error(`Failed to add rule: ${res.status}`);
  }
}

async function removeAccessRule(
  baseUrl: string,
  token: string,
  ruleId: number
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/admin/access-control/${ruleId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to remove rule: ${res.status}`);
  }
}

async function toggleAccessRule(
  baseUrl: string,
  token: string,
  ruleId: number,
  allowed: boolean
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/admin/access-control/${ruleId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ allowed }),
  });
  if (!res.ok) {
    throw new Error(`Failed to toggle rule: ${res.status}`);
  }
}

// --- Component ---

export function AccessControlEditor({
  apiBaseUrl = '',
  authToken = '',
}: AccessControlEditorProps) {
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // New rule form state
  const [newSource, setNewSource] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newAllowed, setNewAllowed] = useState(true);
  const [adding, setAdding] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccessRules(apiBaseUrl, authToken);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleAddRule = async () => {
    if (!newSource.trim() || !newDestination.trim()) {
      setError('Source and destination agent IDs are required');
      return;
    }

    setAdding(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await addAccessRule(apiBaseUrl, authToken, {
        sourceAgent: newSource.trim(),
        destinationAgent: newDestination.trim(),
        allowed: newAllowed,
      });
      setSuccessMessage('Rule added successfully');
      setNewSource('');
      setNewDestination('');
      setNewAllowed(true);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add rule');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveRule = async (ruleId: number) => {
    setError(null);
    setSuccessMessage(null);

    try {
      await removeAccessRule(apiBaseUrl, authToken, ruleId);
      setSuccessMessage('Rule removed');
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove rule');
    }
  };

  const handleToggleRule = async (ruleId: number, currentAllowed: boolean) => {
    setError(null);
    setSuccessMessage(null);

    try {
      await toggleAccessRule(apiBaseUrl, authToken, ruleId, !currentAllowed);
      setSuccessMessage('Rule updated');
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle rule');
    }
  };

  if (loading) {
    return (
      <div className="access-control-editor" aria-busy="true">
        Loading access control matrix...
      </div>
    );
  }

  return (
    <div className="access-control-editor">
      <h2>Access Control Matrix</h2>
      <p>
        Manage CalangoVallum zero-trust rules. Each rule defines whether a source
        agent is allowed to communicate with a destination agent.
      </p>

      {error && (
        <div className="access-control-editor__error" role="alert">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="access-control-editor__success" role="status">
          {successMessage}
        </div>
      )}

      {/* Add new rule form */}
      <fieldset className="access-control-editor__add-form">
        <legend>Add New Rule</legend>
        <div className="access-control-editor__form-row">
          <label>
            Source Agent
            <input
              type="text"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              placeholder="e.g. picoclaw"
              aria-label="Source agent ID"
            />
          </label>
          <label>
            Destination Agent
            <input
              type="text"
              value={newDestination}
              onChange={(e) => setNewDestination(e.target.value)}
              placeholder="e.g. openclaw"
              aria-label="Destination agent ID"
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={newAllowed}
              onChange={(e) => setNewAllowed(e.target.checked)}
              aria-label="Allow communication"
            />
            Allowed
          </label>
          <button
            onClick={() => void handleAddRule()}
            disabled={adding}
            aria-label="Add access control rule"
          >
            {adding ? 'Adding...' : 'Add Rule'}
          </button>
        </div>
      </fieldset>

      {/* Rules table */}
      <table className="access-control-editor__table" aria-label="Access control rules">
        <thead>
          <tr>
            <th scope="col">Source Agent</th>
            <th scope="col">Destination Agent</th>
            <th scope="col">Status</th>
            <th scope="col">Updated</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 ? (
            <tr>
              <td colSpan={5}>No access control rules defined.</td>
            </tr>
          ) : (
            rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.sourceAgent}</td>
                <td>{rule.destinationAgent}</td>
                <td>
                  <span
                    className={
                      rule.allowed
                        ? 'access-control-editor__status--allowed'
                        : 'access-control-editor__status--denied'
                    }
                  >
                    {rule.allowed ? 'Allowed' : 'Denied'}
                  </span>
                </td>
                <td>{new Date(rule.updatedAt).toLocaleString()}</td>
                <td>
                  <button
                    onClick={() => void handleToggleRule(rule.id, rule.allowed)}
                    aria-label={`Toggle rule ${rule.sourceAgent} → ${rule.destinationAgent}`}
                  >
                    {rule.allowed ? 'Deny' : 'Allow'}
                  </button>
                  <button
                    onClick={() => void handleRemoveRule(rule.id)}
                    aria-label={`Remove rule ${rule.sourceAgent} → ${rule.destinationAgent}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="access-control-editor__actions">
        <button
          onClick={() => void loadRules()}
          disabled={loading}
          aria-label="Reload access control rules"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export default AccessControlEditor;
