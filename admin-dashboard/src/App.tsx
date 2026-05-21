/**
 * CalangoFlux Admin Dashboard — Painel de Controle
 *
 * Dashboard completo para monitoramento de agentes, audit trail,
 * leads e configurações do CalangoFlux Agentic OS.
 */

import { useState, useEffect, CSSProperties } from 'react';
import logo from './assets/logo.png';

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentStatus = 'saudavel' | 'degradado' | 'morto';
type NavSection = 'agentes' | 'audit' | 'leads' | 'config';

interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  metric: string;
  metricLabel: string;
}

interface AuditEntry {
  id: number;
  hora: string;
  agente: string;
  acao: string;
  status: 'sucesso' | 'erro' | 'aviso';
}

interface Lead {
  id: number;
  nome: string;
  contato: string;
  interesse: string;
  status: 'novo' | 'qualificado' | 'convertido';
}

// ─── Data ────────────────────────────────────────────────────────────────────

const agentsData: Agent[] = [
  { id: 'ironclaw', name: 'IronClaw', role: 'Runtime', status: 'saudavel', metric: 'CPU 12% · RAM 128MB', metricLabel: 'Recursos' },
  { id: 'vallum', name: 'CalangoVallum', role: 'Segurança', status: 'saudavel', metric: 'CPU 8% · RAM 96MB', metricLabel: 'Recursos' },
  { id: 'picoclaw', name: 'PicoClaw', role: 'Router', status: 'saudavel', metric: 'CPU 3% · RAM 8MB', metricLabel: 'Recursos' },
  { id: 'openclaw', name: 'OpenClaw', role: 'Executor', status: 'saudavel', metric: 'CPU 15% · RAM 192MB', metricLabel: 'Recursos' },
  { id: 'gemini4', name: 'Gemini 4', role: 'Cérebro', status: 'saudavel', metric: '12/15 req/min', metricLabel: 'Throughput' },
];

const auditData: AuditEntry[] = [
  { id: 1, hora: '14:32:01', agente: 'IronClaw', acao: 'Container reiniciado', status: 'sucesso' },
  { id: 2, hora: '14:31:45', agente: 'CalangoVallum', acao: 'Scan de vulnerabilidade concluído', status: 'sucesso' },
  { id: 3, hora: '14:30:22', agente: 'PicoClaw', acao: 'Rota /api/leads atualizada', status: 'sucesso' },
  { id: 4, hora: '14:29:58', agente: 'OpenClaw', acao: 'Execução de workflow #847', status: 'sucesso' },
  { id: 5, hora: '14:28:33', agente: 'Gemini 4', acao: 'Rate limit atingido (15/15)', status: 'aviso' },
  { id: 6, hora: '14:27:10', agente: 'IronClaw', acao: 'Health check OK', status: 'sucesso' },
  { id: 7, hora: '14:26:44', agente: 'CalangoVallum', acao: 'Bloqueio de IP suspeito', status: 'aviso' },
  { id: 8, hora: '14:25:01', agente: 'OpenClaw', acao: 'Timeout em chamada externa', status: 'erro' },
  { id: 9, hora: '14:24:18', agente: 'PicoClaw', acao: 'Balanceamento redistribuído', status: 'sucesso' },
  { id: 10, hora: '14:23:55', agente: 'Gemini 4', acao: 'Modelo carregado com sucesso', status: 'sucesso' },
];

const leadsData: Lead[] = [
  { id: 1, nome: 'Marina Costa', contato: 'marina@eco.org.br', interesse: 'Tokenização de créditos de carbono', status: 'qualificado' },
  { id: 2, nome: 'Rafael Mendes', contato: 'rafael@agritech.io', interesse: 'Automação de monitoramento ambiental', status: 'novo' },
  { id: 3, nome: 'Cooperativa Serra Verde', contato: 'contato@serraverde.coop', interesse: 'Rastreabilidade de produtos orgânicos', status: 'convertido' },
];

// ─── Styles ──────────────────────────────────────────────────────────────────

const colors = {
  bg: '#0f1419',
  card: '#1a2332',
  cardHover: '#1f2b3d',
  accent: '#10b981',
  accentDark: '#059669',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  border: '#2d3748',
  red: '#ef4444',
  yellow: '#f59e0b',
  green: '#10b981',
  sidebar: '#111827',
  header: '#151d2b',
};

const styles: Record<string, CSSProperties> = {
  // Layout
  layout: {
    display: 'flex',
    minHeight: '100vh',
  },
  sidebar: {
    width: '260px',
    backgroundColor: colors.sidebar,
    borderRight: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  sidebarLogo: {
    padding: '24px 20px',
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  sidebarLogoEmoji: {
    fontSize: '28px',
  },
  sidebarLogoText: {
    fontSize: '18px',
    fontWeight: 700,
    color: colors.accent,
    letterSpacing: '-0.5px',
  },
  sidebarNav: {
    padding: '16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: '8px',
    color: colors.textMuted,
    fontSize: '14px',
    fontWeight: 500,
    transition: 'all 0.2s',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
  },
  navItemActive: {
    backgroundColor: `${colors.accent}15`,
    color: colors.accent,
  },
  navIcon: {
    fontSize: '18px',
    width: '24px',
    textAlign: 'center' as const,
  },
  sidebarFooter: {
    padding: '16px 20px',
    borderTop: `1px solid ${colors.border}`,
    fontSize: '11px',
    color: colors.textDim,
  },
  // Main area
  mainArea: {
    marginLeft: '260px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
  },
  header: {
    backgroundColor: colors.header,
    borderBottom: `1px solid ${colors.border}`,
    padding: '16px 32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 50,
  },
  headerTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: colors.text,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: `${colors.green}15`,
    border: `1px solid ${colors.green}40`,
    borderRadius: '20px',
    padding: '6px 14px',
    fontSize: '13px',
    color: colors.green,
    fontWeight: 500,
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: colors.green,
    animation: 'none',
  },
  headerTime: {
    fontSize: '13px',
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  // Content
  content: {
    padding: '32px',
    flex: 1,
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: colors.text,
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionIcon: {
    fontSize: '18px',
  },
  // Metric cards
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  metricCard: {
    backgroundColor: colors.card,
    borderRadius: '12px',
    padding: '20px',
    border: `1px solid ${colors.border}`,
  },
  metricLabel: {
    fontSize: '12px',
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: colors.text,
  },
  metricSuffix: {
    fontSize: '14px',
    color: colors.textMuted,
    fontWeight: 400,
  },
  // Agent cards
  agentsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  agentCard: {
    backgroundColor: colors.card,
    borderRadius: '12px',
    padding: '20px',
    border: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  agentHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agentInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  agentStatusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  agentName: {
    fontSize: '15px',
    fontWeight: 600,
    color: colors.text,
  },
  agentRole: {
    fontSize: '12px',
    color: colors.textMuted,
    marginTop: '2px',
  },
  agentMetric: {
    fontSize: '13px',
    color: colors.textDim,
    backgroundColor: `${colors.border}60`,
    padding: '8px 12px',
    borderRadius: '6px',
    fontFamily: 'monospace',
  },
  agentFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '4px',
  },
  agentStatusLabel: {
    fontSize: '12px',
    fontWeight: 500,
  },
  killButton: {
    fontSize: '11px',
    padding: '4px 10px',
    borderRadius: '4px',
    backgroundColor: `${colors.red}20`,
    color: colors.red,
    border: `1px solid ${colors.red}40`,
    fontWeight: 500,
    cursor: 'pointer',
  },
  // Audit table
  tableWrapper: {
    backgroundColor: colors.card,
    borderRadius: '12px',
    border: `1px solid ${colors.border}`,
    overflow: 'hidden',
    marginBottom: '32px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    borderBottom: `1px solid ${colors.border}`,
    backgroundColor: `${colors.sidebar}80`,
  },
  td: {
    padding: '10px 16px',
    fontSize: '13px',
    color: colors.text,
    borderBottom: `1px solid ${colors.border}30`,
  },
  tdMono: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: colors.textMuted,
  },
  // Status badges
  badgeSucesso: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 500,
    backgroundColor: `${colors.green}20`,
    color: colors.green,
  },
  badgeErro: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 500,
    backgroundColor: `${colors.red}20`,
    color: colors.red,
  },
  badgeAviso: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 500,
    backgroundColor: `${colors.yellow}20`,
    color: colors.yellow,
  },
  // Leads
  leadsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  leadCard: {
    backgroundColor: colors.card,
    borderRadius: '12px',
    padding: '20px',
    border: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  leadName: {
    fontSize: '15px',
    fontWeight: 600,
    color: colors.text,
  },
  leadContact: {
    fontSize: '13px',
    color: colors.accent,
  },
  leadInterest: {
    fontSize: '13px',
    color: colors.textMuted,
    lineHeight: '1.4',
  },
  leadStatus: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  },
  leadNovo: {
    backgroundColor: `${colors.accent}20`,
    color: colors.accent,
  },
  leadQualificado: {
    backgroundColor: `${colors.yellow}20`,
    color: colors.yellow,
  },
  leadConvertido: {
    backgroundColor: `${colors.green}20`,
    color: colors.green,
  },
  // Footer
  footer: {
    padding: '20px 32px',
    borderTop: `1px solid ${colors.border}`,
    textAlign: 'center' as const,
    fontSize: '12px',
    color: colors.textDim,
  },
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'saudavel': return colors.green;
    case 'degradado': return colors.yellow;
    case 'morto': return colors.red;
  }
}

function getStatusLabel(status: AgentStatus): string {
  switch (status) {
    case 'saudavel': return 'Saudável';
    case 'degradado': return 'Degradado';
    case 'morto': return 'Morto';
  }
}

function getAuditBadgeStyle(status: AuditEntry['status']): CSSProperties {
  switch (status) {
    case 'sucesso': return styles.badgeSucesso;
    case 'erro': return styles.badgeErro;
    case 'aviso': return styles.badgeAviso;
  }
}

function getAuditStatusLabel(status: AuditEntry['status']): string {
  switch (status) {
    case 'sucesso': return 'Sucesso';
    case 'erro': return 'Erro';
    case 'aviso': return 'Aviso';
  }
}

function getLeadStatusStyle(status: Lead['status']): CSSProperties {
  const base = styles.leadStatus;
  switch (status) {
    case 'novo': return { ...base, ...styles.leadNovo };
    case 'qualificado': return { ...base, ...styles.leadQualificado };
    case 'convertido': return { ...base, ...styles.leadConvertido };
  }
}

function getLeadStatusLabel(status: Lead['status']): string {
  switch (status) {
    case 'novo': return 'Novo';
    case 'qualificado': return 'Qualificado';
    case 'convertido': return 'Convertido';
  }
}

// ─── Navigation Items ────────────────────────────────────────────────────────

const navItems: { key: NavSection; label: string; icon: string }[] = [
  { key: 'agentes', label: 'Agentes', icon: '🤖' },
  { key: 'audit', label: 'Audit Trail', icon: '📋' },
  { key: 'leads', label: 'Leads', icon: '👥' },
  { key: 'config', label: 'Configurações', icon: '⚙️' },
];

// ─── App Component ───────────────────────────────────────────────────────────

function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('agentes');
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div style={styles.layout}>
      {/* ─── Sidebar ─── */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarLogo}>
          <img src={logo} alt="CalangoFlux" style={{ width: '36px', height: '36px', borderRadius: '8px' }} />
          <span style={styles.sidebarLogoText}>CalangoFlux</span>
        </div>

        <nav style={styles.sidebarNav}>
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveNav(item.key)}
              style={{
                ...styles.navItem,
                ...(activeNav === item.key ? styles.navItemActive : {}),
              }}
              aria-current={activeNav === item.key ? 'page' : undefined}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div style={styles.sidebarFooter}>
          <div>CalangoFlux Agentic OS</div>
          <div style={{ marginTop: '4px' }}>v0.1.0</div>
        </div>
      </aside>

      {/* ─── Main Area ─── */}
      <main style={styles.mainArea}>
        {/* Header */}
        <header style={styles.header}>
          <h1 style={styles.headerTitle}>Painel de Controle</h1>
          <div style={styles.headerRight}>
            <div style={styles.statusBadge}>
              <span style={styles.statusDot} />
              Sistema Operacional
            </div>
            <span style={styles.headerTime}>{formattedTime}</span>
          </div>
        </header>

        {/* Content */}
        <div style={styles.content}>
          {/* ─── Visão Geral (sempre visível) ─── */}
          {activeNav === 'agentes' && (
            <>
              <h2 style={styles.sectionTitle}>
                <span style={styles.sectionIcon}>📊</span>
                Visão Geral
              </h2>
              <div style={styles.metricsGrid}>
                <div style={styles.metricCard}>
                  <div style={styles.metricLabel}>Agentes Ativos</div>
                  <div style={styles.metricValue}>
                    5<span style={styles.metricSuffix}>/5</span>
                  </div>
                </div>
                <div style={styles.metricCard}>
                  <div style={styles.metricLabel}>Mensagens/min</div>
                  <div style={styles.metricValue}>42</div>
                </div>
                <div style={styles.metricCard}>
                  <div style={styles.metricLabel}>Taxa de Erro</div>
                  <div style={{ ...styles.metricValue, color: colors.green }}>
                    0.2<span style={styles.metricSuffix}>%</span>
                  </div>
                </div>
                <div style={styles.metricCard}>
                  <div style={styles.metricLabel}>Uptime</div>
                  <div style={{ ...styles.metricValue, color: colors.accent }}>
                    99.9<span style={styles.metricSuffix}>%</span>
                  </div>
                </div>
              </div>

              {/* ─── Status dos Agentes ─── */}
              <h2 style={styles.sectionTitle}>
                <span style={styles.sectionIcon}>🤖</span>
                Status dos Agentes
              </h2>
              <div style={styles.agentsGrid}>
                {agentsData.map((agent) => (
                  <div key={agent.id} style={styles.agentCard}>
                    <div style={styles.agentHeader}>
                      <div style={styles.agentInfo}>
                        <span
                          style={{
                            ...styles.agentStatusDot,
                            backgroundColor: getStatusColor(agent.status),
                            boxShadow: `0 0 6px ${getStatusColor(agent.status)}60`,
                          }}
                        />
                        <div>
                          <div style={styles.agentName}>{agent.name}</div>
                          <div style={styles.agentRole}>{agent.role}</div>
                        </div>
                      </div>
                    </div>
                    <div style={styles.agentMetric}>
                      {agent.metricLabel}: {agent.metric}
                    </div>
                    <div style={styles.agentFooter}>
                      <span
                        style={{
                          ...styles.agentStatusLabel,
                          color: getStatusColor(agent.status),
                        }}
                      >
                        ● {getStatusLabel(agent.status)}
                      </span>
                      <button style={styles.killButton} onClick={() => alert(`Encerrando ${agent.name}...`)}>Encerrar</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ─── Audit Trail ─── */}
          {activeNav === 'audit' && (
            <>
              <h2 style={styles.sectionTitle}>
                <span style={styles.sectionIcon}>📋</span>
                Audit Trail
              </h2>
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Hora</th>
                      <th style={styles.th}>Agente</th>
                      <th style={styles.th}>Ação</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditData.map((entry) => (
                      <tr key={entry.id}>
                        <td style={{ ...styles.td, ...styles.tdMono }}>{entry.hora}</td>
                        <td style={{ ...styles.td, fontWeight: 500 }}>{entry.agente}</td>
                        <td style={styles.td}>{entry.acao}</td>
                        <td style={styles.td}>
                          <span style={getAuditBadgeStyle(entry.status)}>
                            {getAuditStatusLabel(entry.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ─── Leads ─── */}
          {activeNav === 'leads' && (
            <>
              <h2 style={styles.sectionTitle}>
                <span style={styles.sectionIcon}>👥</span>
                Leads Recentes
              </h2>
              <div style={styles.leadsGrid}>
                {leadsData.map((lead) => (
                  <div key={lead.id} style={styles.leadCard}>
                    <div style={styles.leadName}>{lead.nome}</div>
                    <div style={styles.leadContact}>{lead.contato}</div>
                    <div style={styles.leadInterest}>{lead.interesse}</div>
                    <span style={getLeadStatusStyle(lead.status)}>
                      {getLeadStatusLabel(lead.status)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ─── Configurações ─── */}
          {activeNav === 'config' && (
            <>
              <h2 style={styles.sectionTitle}>
                <span style={styles.sectionIcon}>⚙️</span>
                Configurações
              </h2>
              <div style={styles.metricCard}>
                <div style={styles.metricLabel}>Rate Limit Global</div>
                <div style={{ ...styles.metricValue, fontSize: '20px' }}>60 req/min</div>
              </div>
              <div style={{ ...styles.metricCard, marginTop: '16px' }}>
                <div style={styles.metricLabel}>Health Check Interval</div>
                <div style={{ ...styles.metricValue, fontSize: '20px' }}>30s</div>
              </div>
              <div style={{ ...styles.metricCard, marginTop: '16px' }}>
                <div style={styles.metricLabel}>Projeto GCP</div>
                <div style={{ ...styles.metricValue, fontSize: '16px', fontFamily: 'monospace' }}>calangoflux-agentic-os-497000</div>
              </div>
              <div style={{ ...styles.metricCard, marginTop: '16px' }}>
                <div style={styles.metricLabel}>VM</div>
                <div style={{ ...styles.metricValue, fontSize: '16px', fontFamily: 'monospace' }}>34.151.199.200 (calangoflux-matrix-v2)</div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <footer style={styles.footer}>
          CalangoFlux Agentic OS v0.1.0 — Serra Macaense, RJ
        </footer>
      </main>
    </div>
  );
}

export default App;
