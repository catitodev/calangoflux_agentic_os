/**
 * AuditTrail — Audit trail view
 *
 * Displays the last 100 audit entries from the CHAIN Agent with filtering
 * by actor, action_type, and time range.
 */

import { useState, useMemo } from 'react';

export interface AuditEntryView {
  timestamp: string;
  actor: string;
  actionType: string;
  payloadHash: string;
  entryHash: string;
}

interface AuditTrailProps {
  entries: AuditEntryView[];
}

function AuditTrail({ entries }: AuditTrailProps) {
  const [actorFilter, setActorFilter] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // Derive unique actors and action types for filter dropdowns
  const uniqueActors = useMemo(() => {
    const actors = new Set(entries.map((e) => e.actor));
    return Array.from(actors).sort();
  }, [entries]);

  const uniqueActionTypes = useMemo(() => {
    const types = new Set(entries.map((e) => e.actionType));
    return Array.from(types).sort();
  }, [entries]);

  // Apply filters
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesActor =
        actorFilter === '' || entry.actor === actorFilter;

      const matchesAction =
        actionTypeFilter === '' || entry.actionType === actionTypeFilter;

      let matchesTime = true;
      if (startTime) {
        matchesTime =
          matchesTime && new Date(entry.timestamp) >= new Date(startTime);
      }
      if (endTime) {
        matchesTime =
          matchesTime && new Date(entry.timestamp) <= new Date(endTime);
      }

      return matchesActor && matchesAction && matchesTime;
    });
  }, [entries, actorFilter, actionTypeFilter, startTime, endTime]);

  const clearFilters = () => {
    setActorFilter('');
    setActionTypeFilter('');
    setStartTime('');
    setEndTime('');
  };

  return (
    <div style={{ padding: '16px' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: '20px', fontWeight: 600 }}>
        Audit Trail
      </h2>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '16px',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        {/* Actor filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label
            htmlFor="audit-actor-filter"
            style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}
          >
            Actor
          </label>
          <select
            id="audit-actor-filter"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              minWidth: '140px',
            }}
          >
            <option value="">All actors</option>
            {uniqueActors.map((actor) => (
              <option key={actor} value={actor}>
                {actor}
              </option>
            ))}
          </select>
        </div>

        {/* Action type filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label
            htmlFor="audit-action-filter"
            style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}
          >
            Action Type
          </label>
          <select
            id="audit-action-filter"
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              minWidth: '160px',
            }}
          >
            <option value="">All actions</option>
            {uniqueActionTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {/* Start time */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label
            htmlFor="audit-start-time"
            style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}
          >
            From
          </label>
          <input
            id="audit-start-time"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
            }}
          />
        </div>

        {/* End time */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label
            htmlFor="audit-end-time"
            style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}
          >
            To
          </label>
          <input
            id="audit-end-time"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
            }}
          />
        </div>

        {/* Clear filters */}
        <button
          onClick={clearFilters}
          style={{
            padding: '6px 12px',
            borderRadius: '4px',
            border: '1px solid #d1d5db',
            backgroundColor: '#f9fafb',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Clear
        </button>
      </div>

      {/* Results count */}
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        Showing {filteredEntries.length} of {entries.length} entries (max 100)
      </p>

      {/* Entries table */}
      {filteredEntries.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '32px',
            color: '#9ca3af',
            fontSize: '14px',
          }}
        >
          No audit entries match the current filters.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '2px solid #e5e7eb',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>
                  Timestamp
                </th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Actor</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>
                  Action Type
                </th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>
                  Payload Hash
                </th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>
                  Entry Hash
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry, idx) => (
                <tr
                  key={entry.entryHash}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb',
                  }}
                >
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{entry.actor}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span
                      style={{
                        backgroundColor: '#e5e7eb',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                      }}
                    >
                      {entry.actionType}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: '#6b7280',
                    }}
                  >
                    {entry.payloadHash.slice(0, 16)}…
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: '#6b7280',
                    }}
                  >
                    {entry.entryHash.slice(0, 16)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AuditTrail;
