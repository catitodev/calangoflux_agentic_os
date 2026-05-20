/**
 * Admin Dashboard API Client
 *
 * Handles all communication with the CalangoFlux Agentic OS backend.
 * Includes JWT authentication headers on every request.
 */

export interface AgentStatusView {
  agentId: string;
  status: 'healthy' | 'degraded' | 'dead';
  cpuUsage: number;
  memoryUsage: number;
  messagesThroughput: number;
  uptime: number;
}

export interface AuditEntryView {
  timestamp: string;
  actor: string;
  actionType: string;
  payloadHash: string;
  entryHash: string;
}

export interface LeadView {
  id: string;
  name?: string;
  contact: string;
  interest: string;
  conversationHistory: Message[];
  status: 'new' | 'contacted' | 'converted' | 'lost';
  createdAt: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ConfigUpdate {
  rateLimits?: { agentId: string; maxPerMinute: number }[];
  healthCheckInterval?: number;
  agentEnabled?: { agentId: string; enabled: boolean }[];
}

export interface MetricsView {
  throughput: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  errorRate: number;
  activeAgents: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? (import.meta.env.VITE_API_BASE_URL as string) ?? '/api/admin';
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => undefined);
      throw new ApiClientError(
        `Request failed: ${method} ${path} — ${response.status}`,
        response.status,
        errorBody,
      );
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  /** Authenticate with email and password, returns JWT token */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const result = await this.request<LoginResponse>('POST', '/login', credentials);
    this.token = result.token;
    return result;
  }

  /** GET /agents — List all agents with status */
  async getAgents(): Promise<AgentStatusView[]> {
    return this.request<AgentStatusView[]>('GET', '/agents');
  }

  /** POST /agents/:id/kill — Kill switch for an agent */
  async killAgent(agentId: string): Promise<void> {
    await this.request<void>('POST', `/agents/${encodeURIComponent(agentId)}/kill`);
  }

  /** GET /audit?limit=100 — Last N audit entries */
  async getAuditEntries(limit = 100): Promise<AuditEntryView[]> {
    return this.request<AuditEntryView[]>('GET', `/audit?limit=${limit}`);
  }

  /** GET /leads — All leads with conversation history */
  async getLeads(): Promise<LeadView[]> {
    return this.request<LeadView[]>('GET', '/leads');
  }

  /** PUT /config — Update configuration without redeployment */
  async updateConfig(config: ConfigUpdate): Promise<void> {
    await this.request<void>('PUT', '/config', config);
  }

  /** GET /metrics — Real-time metrics (throughput, latency, errors) */
  async getMetrics(): Promise<MetricsView> {
    return this.request<MetricsView>('GET', '/metrics');
  }
}

/** Singleton API client instance */
export const apiClient = new ApiClient();
