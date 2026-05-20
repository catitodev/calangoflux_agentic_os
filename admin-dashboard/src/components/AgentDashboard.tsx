/**
 * AgentDashboard — Main dashboard showing all agents with real-time monitoring
 *
 * Displays all registered agents with their status (healthy/degraded/dead),
 * CPU/memory usage, and message throughput. Polls every 5 seconds for real-time updates.
 * Requirements: 14.2, 14.3
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import type { AgentStatusView } from '../api/client';
import { AgentCard } from './AgentCard';

const POLL_INTERVAL_MS = 5000;

export interface AgentDashboardProps {
  /** Override polling interval in ms (default: 5000) */
  pollInterval?: number;
}

export function AgentDashboard({ pollInterval = POLL_INTERVAL_MS }: AgentDashboardProps) {
  const [agents, setAgents] = useState<AgentStatusView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await apiClient.getAgents();
      setAgents(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and polling setup
  useEffect(() => {
    void fetchAgents();

    intervalRef.current = setInterval(() => {
      void fetchAgents();
    }, pollInterval);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchAgents, pollInterval]);

  const handleAgentKilled = useCallback(() => {
    // Immediately refresh after a kill action
    void fetchAgents();
  }, [fetchAgents]);

  const healthyCount = agents.filter((a) => a.status === 'healthy').length;
  const degradedCount = agents.filter((a) => a.status === 'degraded').length;
  const deadCount = agents.filter((a) => a.status === 'dead').length;

  if (loading) {
    return (
      <section className="agent-dashboard" aria-busy="true">
        <h2>Agent Monitoring</h2>
        <p>Loading agents...</p>
      </section>
    );
  }

  return (
    <section className="agent-dashboard">
      <header className="agent-dashboard__header">
        <h2>Agent Monitoring</h2>
        <div className="agent-dashboard__summary" aria-label="Agent status summary">
          <span className="agent-dashboard__count agent-dashboard__count--healthy">
            {healthyCount} healthy
          </span>
          <span className="agent-dashboard__count agent-dashboard__count--degraded">
            {degradedCount} degraded
          </span>
          <span className="agent-dashboard__count agent-dashboard__count--dead">
            {deadCount} dead
          </span>
        </div>
        {lastUpdated && (
          <p className="agent-dashboard__updated">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </header>

      {error && (
        <div className="agent-dashboard__error" role="alert">
          {error}
        </div>
      )}

      {agents.length === 0 && !error && (
        <p className="agent-dashboard__empty">No agents registered.</p>
      )}

      <div className="agent-dashboard__grid" role="list">
        {agents.map((agent) => (
          <div key={agent.agentId} role="listitem">
            <AgentCard agent={agent} onKilled={handleAgentKilled} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default AgentDashboard;
