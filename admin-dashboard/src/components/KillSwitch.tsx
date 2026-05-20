/**
 * KillSwitch — Emergency kill button for an agent
 *
 * Calls POST /agents/:id/kill with a confirmation dialog to prevent accidental termination.
 * Requirements: 14.3
 */

import { useState, useCallback } from 'react';
import { apiClient } from '../api/client';

export interface KillSwitchProps {
  agentId: string;
  agentStatus: 'healthy' | 'degraded' | 'dead';
  onKilled?: () => void;
}

export function KillSwitch({ agentId, agentStatus, onKilled }: KillSwitchProps) {
  const [confirming, setConfirming] = useState(false);
  const [killing, setKilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleKillRequest = useCallback(() => {
    setConfirming(true);
    setError(null);
  }, []);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  const handleConfirmKill = useCallback(async () => {
    setKilling(true);
    setError(null);
    try {
      await apiClient.killAgent(agentId);
      setConfirming(false);
      onKilled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to kill agent');
    } finally {
      setKilling(false);
    }
  }, [agentId, onKilled]);

  const isDisabled = agentStatus === 'dead';

  if (confirming) {
    return (
      <div className="kill-switch kill-switch--confirming" role="dialog" aria-label="Confirm agent termination">
        <p className="kill-switch__warning">
          Terminate agent <strong>{agentId}</strong>? This action cannot be undone.
        </p>
        {error && (
          <p className="kill-switch__error" role="alert">{error}</p>
        )}
        <div className="kill-switch__actions">
          <button
            className="kill-switch__confirm-btn"
            onClick={() => void handleConfirmKill()}
            disabled={killing}
            aria-label={`Confirm kill ${agentId}`}
          >
            {killing ? 'Terminating...' : 'Confirm Kill'}
          </button>
          <button
            className="kill-switch__cancel-btn"
            onClick={handleCancel}
            disabled={killing}
            aria-label="Cancel termination"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kill-switch">
      {error && (
        <p className="kill-switch__error" role="alert">{error}</p>
      )}
      <button
        className="kill-switch__btn"
        onClick={handleKillRequest}
        disabled={isDisabled}
        aria-label={`Kill agent ${agentId}`}
        title={isDisabled ? 'Agent is already dead' : `Terminate agent ${agentId}`}
      >
        Kill
      </button>
    </div>
  );
}

export default KillSwitch;
