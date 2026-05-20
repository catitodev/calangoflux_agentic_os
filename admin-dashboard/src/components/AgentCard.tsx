/**
 * AgentCard — Individual agent card with status indicator, metrics, and kill switch
 *
 * Displays agent health status, CPU/memory usage, message throughput, and uptime.
 * Includes a kill switch button for emergency termination.
 * Requirements: 14.2, 14.3
 */

import type { AgentStatusView } from '../api/client';
import { KillSwitch } from './KillSwitch';

export interface AgentCardProps {
  agent: AgentStatusView;
  onKilled?: () => void;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function statusClassName(status: AgentStatusView['status']): string {
  switch (status) {
    case 'healthy':
      return 'agent-card__status--healthy';
    case 'degraded':
      return 'agent-card__status--degraded';
    case 'dead':
      return 'agent-card__status--dead';
  }
}

export function AgentCard({ agent, onKilled }: AgentCardProps) {
  return (
    <article className="agent-card" aria-label={`Agent ${agent.agentId}`}>
      <header className="agent-card__header">
        <h3 className="agent-card__name">{agent.agentId}</h3>
        <span
          className={`agent-card__status ${statusClassName(agent.status)}`}
          aria-label={`Status: ${agent.status}`}
        >
          {agent.status}
        </span>
      </header>

      <dl className="agent-card__metrics">
        <div className="agent-card__metric">
          <dt>CPU</dt>
          <dd>{agent.cpuUsage.toFixed(1)}%</dd>
        </div>
        <div className="agent-card__metric">
          <dt>Memory</dt>
          <dd>{agent.memoryUsage.toFixed(1)} MB</dd>
        </div>
        <div className="agent-card__metric">
          <dt>Throughput</dt>
          <dd>{agent.messagesThroughput.toFixed(1)} msg/s</dd>
        </div>
        <div className="agent-card__metric">
          <dt>Uptime</dt>
          <dd>{formatUptime(agent.uptime)}</dd>
        </div>
      </dl>

      <footer className="agent-card__footer">
        <KillSwitch
          agentId={agent.agentId}
          agentStatus={agent.status}
          onKilled={onKilled}
        />
      </footer>
    </article>
  );
}

export default AgentCard;
