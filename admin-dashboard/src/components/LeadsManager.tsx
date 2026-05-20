/**
 * LeadsManager — Leads management view
 *
 * Shows all captured leads with conversation history, interest, and status.
 * Supports filtering by status (new/contacted/converted/lost).
 */

import { useState, useMemo } from 'react';
import LeadCard, { LeadView, LeadStatus } from './LeadCard';

interface LeadsManagerProps {
  leads: LeadView[];
  onStatusChange?: (leadId: string, newStatus: LeadStatus) => void;
}

type StatusFilter = LeadStatus | 'all';

function LeadsManager({ leads, onStatusChange }: LeadsManagerProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesStatus =
        statusFilter === 'all' || lead.status === statusFilter;

      const query = searchQuery.toLowerCase();
      const matchesSearch =
        query === '' ||
        (lead.name?.toLowerCase().includes(query) ?? false) ||
        lead.contact.toLowerCase().includes(query) ||
        lead.interest.toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [leads, statusFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: leads.length,
      new: 0,
      contacted: 0,
      converted: 0,
      lost: 0,
    };
    for (const lead of leads) {
      counts[lead.status]++;
    }
    return counts;
  }, [leads]);

  return (
    <div style={{ padding: '16px' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: '20px', fontWeight: 600 }}>
        Leads Management
      </h2>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '16px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {/* Status filter buttons */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(
            ['all', 'new', 'contacted', 'converted', 'lost'] as StatusFilter[]
          ).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border:
                  statusFilter === status
                    ? '2px solid #2563eb'
                    : '1px solid #d1d5db',
                backgroundColor:
                  statusFilter === status ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: statusFilter === status ? 600 : 400,
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)} (
              {statusCounts[status]})
            </button>
          ))}
        </div>

        {/* Search input */}
        <input
          type="text"
          placeholder="Search by name, contact, or interest..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '13px',
            minWidth: '240px',
          }}
        />
      </div>

      {/* Results count */}
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        Showing {filteredLeads.length} of {leads.length} leads
      </p>

      {/* Lead cards */}
      {filteredLeads.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '32px',
            color: '#9ca3af',
            fontSize: '14px',
          }}
        >
          No leads match the current filters.
        </div>
      ) : (
        <div>
          {filteredLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default LeadsManager;
