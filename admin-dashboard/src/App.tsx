import React, { useState, useEffect, useCallback, CSSProperties } from 'react';
import logo from './assets/logo.png';

// ─── Types ───────────────────────────────────────────────────────────────────

type Section = 'inicio' | 'agentes' | 'chat' | 'airtable' | 'todo' | 'links' | 'config';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  category: 'urgente' | 'hoje' | 'semana';
}

interface AgentInfo {
  name: string;
  role: string;
  status: 'online' | 'offline' | 'idle';
  emoji: string;
  metrics: { label: string; value: string }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = '8893664184:AAFiR5J4EWqPE5PuTKwDkt_6_jY3eSxFSWM';
const TELEGRAM_CHAT_ID = '5279941882';
const IRONCLAW_API = 'http://34.151.199.200:8080/api/tasks';

const AGENTS: AgentInfo[] = [
  { name: 'IronClaw', role: 'Orquestrador Principal (Rust)', status: 'online', emoji: '🦾', metrics: [{ label: 'Tasks/h', value: '142' }, { label: 'Latência', value: '12ms' }] },
  { name: 'CalangoVallum', role: 'Segurança & Firewall (Rust)', status: 'online', emoji: '🛡️', metrics: [{ label: 'Bloqueios', value: '23' }, { label: 'Scans', value: '1.2k' }] },
  { name: 'PicoClaw', role: 'Load Balancer (Go)', status: 'online', emoji: '⚡', metrics: [{ label: 'Req/s', value: '340' }, { label: 'Uptime', value: '99.9%' }] },
  { name: 'OpenClaw', role: 'API Gateway (TypeScript)', status: 'idle', emoji: '🔗', metrics: [{ label: 'Rotas', value: '18' }, { label: 'Cache Hit', value: '87%' }] },
  { name: 'Gemini', role: 'LLM & NLP (Google AI)', status: 'online', emoji: '🧠', metrics: [{ label: 'Tokens/min', value: '4.2k' }, { label: 'Custo/dia', value: '$0.12' }] },
];

const LINKS = [
  { title: 'Notion Central', url: 'https://www.notion.so/Central-CalangoFlux-1e5b1e6168d18045b612e8a1957e37dc', emoji: '📓' },
  { title: 'Airtable', url: 'https://airtable.com/app6E9h1XmC6tZbQW', emoji: '📊' },
  { title: 'GitHub', url: 'https://github.com/catitodev/calangoflux_agentic_os', emoji: '🐙' },
  { title: 'Site', url: 'https://calangoflux.xyz', emoji: '🌐' },
  { title: 'Supabase', url: 'https://supabase.com/dashboard', emoji: '🗄️' },
  { title: 'Google Cloud', url: 'https://console.cloud.google.com', emoji: '☁️' },
  { title: 'Telegram Grupo', url: 'https://t.me/+IcWswgNUbrNjYTIx', emoji: '💬' },
  { title: 'Google AI Studio', url: 'https://aistudio.google.com', emoji: '🤖' },
];

const NAV_ITEMS: { key: Section; label: string; emoji: string }[] = [
  { key: 'inicio', label: 'Início', emoji: '🏠' },
  { key: 'agentes', label: 'Agentes', emoji: '🤖' },
  { key: 'chat', label: 'Chat', emoji: '💬' },
  { key: 'airtable', label: 'Airtable', emoji: '📋' },
  { key: 'todo', label: 'Todo List', emoji: '📝' },
  { key: 'links', label: 'Links Rápidos', emoji: '🔗' },
  { key: 'config', label: 'Config', emoji: '⚙️' },
];


// ─── Styles ──────────────────────────────────────────────────────────────────

const colors = {
  bg: '#0f1419',
  card: '#1a2332',
  cardHover: '#1f2b3d',
  accent: '#10b981',
  accentDim: '#059669',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  border: '#2d3748',
  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#10b981',
};

const baseCard: CSSProperties = {
  background: colors.card,
  borderRadius: '12px',
  padding: '20px',
  border: `1px solid ${colors.border}`,
  transition: 'all 0.2s ease',
};

const baseButton: CSSProperties = {
  background: colors.accent,
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '10px 20px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '14px',
  transition: 'all 0.2s ease',
};

// ─── Utility ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 12);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'online' | 'offline' | 'idle' }) {
  const colorMap = { online: colors.success, offline: colors.danger, idle: colors.warning };
  const style: CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: colorMap[status],
    display: 'inline-block',
    boxShadow: `0 0 6px ${colorMap[status]}`,
  };
  return <span style={style} />;
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header() {
  const [time, setTime] = useState(formatTime(new Date()));

  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime(new Date())), 1000);
    return () => clearInterval(interval);
  }, []);

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    background: colors.card,
    borderBottom: `1px solid ${colors.border}`,
    position: 'sticky',
    top: 0,
    zIndex: 100,
  };

  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src={logo} alt="CalangoFlux" style={{ width: '32px', height: '32px', borderRadius: '8px' }} />
        <span style={{ fontSize: '18px', fontWeight: 700, color: colors.text }}>CalangoFlux Admin</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ color: colors.textMuted, fontSize: '13px', fontFamily: 'monospace' }}>{time}</span>
        <span style={{
          background: '#10b98133',
          color: colors.accent,
          padding: '4px 12px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 600,
        }}>
          ● Sistema Online
        </span>
      </div>
    </header>
  );
}


// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ active, onNavigate, collapsed, onToggle }: {
  active: Section;
  onNavigate: (s: Section) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const sidebarStyle: CSSProperties = {
    width: collapsed ? '60px' : '220px',
    background: colors.card,
    borderRight: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 8px',
    transition: 'width 0.2s ease',
    overflow: 'hidden',
    flexShrink: 0,
  };

  const navItemStyle = (isActive: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    background: isActive ? '#10b98120' : 'transparent',
    color: isActive ? colors.accent : colors.textMuted,
    fontSize: '14px',
    fontWeight: isActive ? 600 : 400,
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
    border: 'none',
    width: '100%',
    textAlign: 'left',
  });

  return (
    <aside style={sidebarStyle}>
      <button
        onClick={onToggle}
        style={{
          background: 'none',
          border: 'none',
          color: colors.textMuted,
          cursor: 'pointer',
          padding: '8px',
          fontSize: '18px',
          marginBottom: '12px',
          borderRadius: '6px',
        }}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? '☰' : '✕'}
      </button>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            style={navItemStyle(active === item.key)}
            aria-current={active === item.key ? 'page' : undefined}
          >
            <span style={{ fontSize: '16px' }}>{item.emoji}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ─── Início (Home) ───────────────────────────────────────────────────────────

function InicioSection({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const [sending, setSending] = useState(false);

  const metrics = [
    { label: 'Agentes Ativos', value: '5', icon: '🤖' },
    { label: 'Mensagens/min', value: '24', icon: '💬' },
    { label: 'Leads Hoje', value: '3', icon: '🎯' },
    { label: 'Uptime', value: '99.8%', icon: '⏱️' },
  ];

  const sendTelegram = async () => {
    setSending(true);
    try {
      const msg = `📊 CalangoFlux Status Report\n\n✅ Agentes: 5 online\n💬 Mensagens/min: 24\n🎯 Leads hoje: 3\n⏱️ Uptime: 99.8%\n\n🕐 ${new Date().toLocaleString('pt-BR')}`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' }),
      });
    } catch (e) {
      console.error('Telegram error:', e);
    } finally {
      setSending(false);
    }
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  };

  return (
    <div>
      <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>
        Visão Geral
      </h2>
      <div style={gridStyle}>
        {metrics.map((m) => (
          <div key={m.label} style={{ ...baseCard, textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{m.icon}</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: colors.accent }}>{m.value}</div>
            <div style={{ fontSize: '13px', color: colors.textMuted, marginTop: '4px' }}>{m.label}</div>
          </div>
        ))}
      </div>

      <h3 style={{ color: colors.text, fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
        Status dos Agentes
      </h3>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
        {AGENTS.map((agent) => (
          <div key={agent.name} style={{ ...baseCard, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', minWidth: '160px', flex: '1' }}>
            <span style={{ fontSize: '20px' }}>{agent.emoji}</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text }}>{agent.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <StatusDot status={agent.status} />
                <span style={{ fontSize: '11px', color: colors.textMuted }}>{agent.status}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={sendTelegram} disabled={sending} style={{ ...baseButton, opacity: sending ? 0.6 : 1 }}>
          {sending ? '⏳ Enviando...' : '📤 Enviar para Telegram'}
        </button>
        <button onClick={() => onNavigate('chat')} style={{ ...baseButton, background: colors.card, border: `1px solid ${colors.border}` }}>
          💬 Abrir Chat
        </button>
      </div>
    </div>
  );
}


// ─── Agentes ─────────────────────────────────────────────────────────────────

function AgentesSection({ onOpenChat }: { onOpenChat: (agent: string) => void }) {
  const cardGrid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
  };

  return (
    <div>
      <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>
        Agentes do Sistema
      </h2>
      <div style={cardGrid}>
        {AGENTS.map((agent) => (
          <div key={agent.name} style={{ ...baseCard }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '28px' }}>{agent.emoji}</span>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: colors.text }}>{agent.name}</div>
                  <div style={{ fontSize: '12px', color: colors.textMuted }}>{agent.role}</div>
                </div>
              </div>
              <StatusDot status={agent.status} />
            </div>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              {agent.metrics.map((m) => (
                <div key={m.label}>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: colors.accent }}>{m.value}</div>
                  <div style={{ fontSize: '11px', color: colors.textMuted }}>{m.label}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => onOpenChat(agent.name)}
              style={{ ...baseButton, width: '100%', padding: '8px', fontSize: '13px' }}
            >
              💬 Abrir Chat
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function ChatSection({ agentContext }: { agentContext: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: input.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(IRONCLAW_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer calangoflux-jwt-dev-change-in-production',
        },
        body: JSON.stringify({
          task: input.trim(),
          agent: agentContext || 'Gemini',
          context: `Dashboard Admin - Agente: ${agentContext || 'Gemini'}`,
        }),
      });
      const data = await res.json() as { response?: string; result?: string; message?: string };
      const content = data.response || data.result || data.message || 'Resposta recebida com sucesso.';
      const assistantMsg: ChatMessage = { id: generateId(), role: 'assistant', content, timestamp: Date.now() };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = { id: generateId(), role: 'assistant', content: '⚠️ Erro ao conectar com o servidor. Verifique se o IronClaw está online.', timestamp: Date.now() };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, agentContext]);

  const sendToTelegram = async () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: `🤖 ${agentContext || 'Gemini'}:\n\n${lastAssistant.content}` }),
      });
    } catch (e) {
      console.error('Telegram send error:', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const chatContainer: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 180px)',
    maxHeight: '700px',
  };

  const messagesArea: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  };

  const bubbleStyle = (isUser: boolean): CSSProperties => ({
    maxWidth: '75%',
    padding: '12px 16px',
    borderRadius: '12px',
    fontSize: '14px',
    lineHeight: '1.5',
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    background: isUser ? colors.accent : colors.card,
    color: isUser ? '#fff' : colors.text,
    border: isUser ? 'none' : `1px solid ${colors.border}`,
    wordBreak: 'break-word',
  });

  return (
    <div style={chatContainer}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, margin: 0 }}>
          Chat — {agentContext || 'Gemini'}
        </h2>
        <button onClick={() => void sendToTelegram()} style={{ ...baseButton, padding: '6px 14px', fontSize: '12px' }}>
          📤 Enviar para Telegram
        </button>
      </div>

      <div style={{ ...baseCard, flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={messagesArea}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: colors.textMuted, marginTop: '40px' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>💬</div>
              <p>Envie uma mensagem para iniciar a conversa com {agentContext || 'Gemini'}</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={bubbleStyle(msg.role === 'user')}>
              {msg.content}
            </div>
          ))}
          {loading && (
            <div style={bubbleStyle(false)}>
              <span style={{ opacity: 0.7 }}>⏳ Processando...</span>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}`, display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            style={{
              flex: 1,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '10px 14px',
              color: colors.text,
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button onClick={() => void sendMessage()} disabled={loading || !input.trim()} style={{ ...baseButton, opacity: loading || !input.trim() ? 0.5 : 1 }}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Airtable ────────────────────────────────────────────────────────────────

function AirtableSection() {
  return (
    <div style={{ height: 'calc(100vh - 160px)' }}>
      <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, marginBottom: '16px' }}>
        Airtable — CRM & Pipeline
      </h2>
      <iframe
        src="https://airtable.com/embed/app6E9h1XmC6tZbQW"
        title="Airtable CalangoFlux"
        style={{
          width: '100%',
          height: 'calc(100% - 50px)',
          border: `1px solid ${colors.border}`,
          borderRadius: '12px',
          background: colors.card,
        }}
        allowFullScreen
      />
    </div>
  );
}

// ─── Todo List ───────────────────────────────────────────────────────────────

function TodoSection() {
  const [todos, setTodos] = useState<TodoItem[]>(() => {
    try {
      const stored = localStorage.getItem('calangoflux-todos');
      return stored ? JSON.parse(stored) as TodoItem[] : [];
    } catch {
      return [];
    }
  });
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<TodoItem['category']>('hoje');

  useEffect(() => {
    localStorage.setItem('calangoflux-todos', JSON.stringify(todos));
  }, [todos]);

  const addTodo = () => {
    if (!newText.trim()) return;
    setTodos((prev) => [...prev, { id: generateId(), text: newText.trim(), done: false, category: newCategory }]);
    setNewText('');
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const removeTodo = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo();
  };

  const categoryLabels: Record<TodoItem['category'], { label: string; color: string }> = {
    urgente: { label: '🔴 Urgente', color: colors.danger },
    hoje: { label: '🟡 Hoje', color: colors.warning },
    semana: { label: '🟢 Esta Semana', color: colors.success },
  };

  const categories: TodoItem['category'][] = ['urgente', 'hoje', 'semana'];

  return (
    <div>
      <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>
        Todo List
      </h2>

      <div style={{ ...baseCard, marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nova tarefa..."
          style={{
            flex: 1,
            minWidth: '200px',
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '10px 14px',
            color: colors.text,
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as TodoItem['category'])}
          style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '10px 14px',
            color: colors.text,
            fontSize: '14px',
            outline: 'none',
          }}
        >
          <option value="urgente">🔴 Urgente</option>
          <option value="hoje">🟡 Hoje</option>
          <option value="semana">🟢 Esta Semana</option>
        </select>
        <button onClick={addTodo} style={baseButton}>+ Adicionar</button>
      </div>

      {categories.map((cat) => {
        const items = todos.filter((t) => t.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: '20px' }}>
            <h3 style={{ color: categoryLabels[cat].color, fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
              {categoryLabels[cat].label} ({items.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {items.map((todo) => (
                <div key={todo.id} style={{
                  ...baseCard,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  opacity: todo.done ? 0.5 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => toggleTodo(todo.id)}
                    style={{ width: '16px', height: '16px', accentColor: colors.accent, cursor: 'pointer' }}
                  />
                  <span style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: '14px',
                    textDecoration: todo.done ? 'line-through' : 'none',
                  }}>
                    {todo.text}
                  </span>
                  <button
                    onClick={() => removeTodo(todo.id)}
                    style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: '16px', padding: '4px' }}
                    aria-label="Remover tarefa"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {todos.length === 0 && (
        <div style={{ textAlign: 'center', color: colors.textMuted, padding: '40px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📝</div>
          <p>Nenhuma tarefa ainda. Adicione uma acima!</p>
        </div>
      )}
    </div>
  );
}


// ─── Links Rápidos ───────────────────────────────────────────────────────────

function LinksSection() {
  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
  };

  return (
    <div>
      <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>
        Links Rápidos
      </h2>
      <div style={gridStyle}>
        {LINKS.map((link) => (
          <a
            key={link.title}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...baseCard,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '24px' }}>{link.emoji}</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: colors.text }}>{link.title}</div>
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '2px' }}>
                {new URL(link.url).hostname}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Config ──────────────────────────────────────────────────────────────────

function ConfigSection() {
  return (
    <div>
      <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>
        Configurações
      </h2>
      <div style={{ ...baseCard, marginBottom: '16px' }}>
        <h3 style={{ color: colors.text, fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Sistema</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>Versão</span>
            <span style={{ color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>v0.1.0</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>Ambiente</span>
            <span style={{ color: colors.accent, fontSize: '14px' }}>Desenvolvimento</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>API Gateway</span>
            <span style={{ color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>34.151.199.200:8080</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>Projeto GCP</span>
            <span style={{ color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>calangoflux-agentic-os-497000</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>Região</span>
            <span style={{ color: colors.text, fontSize: '14px' }}>southamerica-east1</span>
          </div>
        </div>
      </div>

      <div style={{ ...baseCard }}>
        <h3 style={{ color: colors.text, fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Integrações</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { name: 'Telegram Bot', status: 'Conectado' },
            { name: 'Airtable', status: 'Conectado' },
            { name: 'Supabase', status: 'Configurando' },
            { name: 'Notion', status: 'Conectado' },
            { name: 'Google AI (Gemini)', status: 'Conectado' },
          ].map((item) => (
            <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ color: colors.textMuted, fontSize: '14px' }}>{item.name}</span>
              <span style={{ color: item.status === 'Conectado' ? colors.success : colors.warning, fontSize: '14px' }}>
                {item.status === 'Conectado' ? '●' : '○'} {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  const footerStyle: CSSProperties = {
    padding: '12px 24px',
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: '12px',
    borderTop: `1px solid ${colors.border}`,
    background: colors.card,
  };

  return (
    <footer style={footerStyle}>
      CalangoFlux Agentic OS v0.1.0 — Serra Macaense, RJ
    </footer>
  );
}

// ─── App (Main) ──────────────────────────────────────────────────────────────

export default function App() {
  const [section, setSection] = useState<Section>('inicio');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatAgent, setChatAgent] = useState('Gemini');

  const handleOpenChat = (agent: string) => {
    setChatAgent(agent);
    setSection('chat');
  };

  const handleNavigate = (s: Section) => {
    setSection(s);
  };

  const renderSection = () => {
    switch (section) {
      case 'inicio':
        return <InicioSection onNavigate={handleNavigate} />;
      case 'agentes':
        return <AgentesSection onOpenChat={handleOpenChat} />;
      case 'chat':
        return <ChatSection agentContext={chatAgent} />;
      case 'airtable':
        return <AirtableSection />;
      case 'todo':
        return <TodoSection />;
      case 'links':
        return <LinksSection />;
      case 'config':
        return <ConfigSection />;
    }
  };

  const appStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: colors.bg,
    color: colors.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    overflow: 'hidden',
  };

  const mainLayout: CSSProperties = {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  };

  const contentArea: CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
  };

  // Responsive: collapse sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div style={appStyle}>
      <Header />
      <div style={mainLayout}>
        <Sidebar
          active={section}
          onNavigate={handleNavigate}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <main style={contentArea}>
          {renderSection()}
        </main>
      </div>
      <Footer />
    </div>
  );
}
