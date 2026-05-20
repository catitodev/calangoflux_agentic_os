/**
 * LeadCard — Individual lead card component
 *
 * Displays contact info, interest, status badge, and conversation preview
 * for a single captured lead.
 */



export type LeadStatus = 'new' | 'contacted' | 'converted' | 'lost';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface LeadView {
  id: string;
  name?: string;
  contact: string;
  interest: string;
  conversationHistory: Message[];
  status: LeadStatus;
  createdAt: string;
}

interface LeadCardProps {
  lead: LeadView;
  onStatusChange?: (leadId: string, newStatus: LeadStatus) => void;
}

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: '#3b82f6',
  contacted: '#f59e0b',
  converted: '#10b981',
  lost: '#ef4444',
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
  lost: 'Lost',
};

function LeadCard({ lead, onStatusChange }: LeadCardProps) {
  const lastMessages = lead.conversationHistory.slice(-3);
  const statusColor = STATUS_COLORS[lead.status];
  const statusLabel = STATUS_LABELS[lead.status];

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '12px',
        backgroundColor: '#ffffff',
      }}
    >
      {/* Header: Name/Contact + Status Badge */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            {lead.name || 'Anonymous'}
          </h3>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>
            {lead.contact}
          </span>
        </div>
        <span
          style={{
            backgroundColor: statusColor,
            color: '#ffffff',
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Interest */}
      <div style={{ marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>
          Interest
        </span>
        <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#374151' }}>
          {lead.interest}
        </p>
      </div>

      {/* Conversation Preview (last 3 messages) */}
      {lastMessages.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <span
            style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}
          >
            Conversation Preview
          </span>
          <div
            style={{
              marginTop: '4px',
              maxHeight: '120px',
              overflowY: 'auto',
              fontSize: '13px',
            }}
          >
            {lastMessages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  padding: '4px 0',
                  borderBottom:
                    idx < lastMessages.length - 1
                      ? '1px solid #f3f4f6'
                      : 'none',
                }}
              >
                <strong style={{ color: msg.role === 'user' ? '#2563eb' : '#059669' }}>
                  {msg.role === 'user' ? 'User' : 'Bot'}:
                </strong>{' '}
                <span style={{ color: '#4b5563' }}>
                  {msg.content.length > 80
                    ? msg.content.slice(0, 80) + '…'
                    : msg.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer: Created date + Status change */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid #f3f4f6',
          paddingTop: '8px',
        }}
      >
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          Created: {new Date(lead.createdAt).toLocaleDateString()}
        </span>
        {onStatusChange && (
          <select
            value={lead.status}
            onChange={(e) =>
              onStatusChange(lead.id, e.target.value as LeadStatus)
            }
            style={{
              fontSize: '12px',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
            }}
          >
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
          </select>
        )}
      </div>
    </div>
  );
}

export default LeadCard;
