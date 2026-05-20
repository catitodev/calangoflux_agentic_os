/**
 * OpenClaw — Action Executor
 *
 * Executes external actions with retry logic (exponential backoff),
 * timeout enforcement, and credential management via the vault.
 */

// === Core Interfaces ===

export interface ActionRequest {
  id: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>;
  timeout: number; // max 30 seconds default
}

export interface ActionResult {
  requestId: string;
  status: 'success' | 'failure';
  duration: number; // milliseconds
  output: unknown;
  error?: string;
}

export interface ScopedToken {
  token: string;
  expiresAt: number; // unix timestamp, max 5 min TTL
  scope: string[];
}

export interface Tool {
  name: string;
  description: string;
  execute(params: Record<string, unknown>, credential: ScopedToken): Promise<unknown>;
}

export interface CredentialVaultClient {
  getCredential(agentId: string, secretId: string): Promise<ScopedToken>;
}

export interface MessageBusClient {
  publish(stream: string, fields: Record<string, string>): Promise<string>;
}

// === Constants ===

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/** Backoff delays for retries: 1s, 4s, 16s (exponential) */
const BACKOFF_DELAYS = [1_000, 4_000, 16_000];

// === Helpers ===

/**
 * Creates a promise that rejects after the specified timeout.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Action timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Sleep for the specified duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// === ActionExecutor Class ===

export class ActionExecutor {
  private readonly credentialVault: CredentialVaultClient;
  private readonly messageBus: MessageBusClient;
  private readonly tools: Map<string, Tool>;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    credentialVault: CredentialVaultClient,
    messageBus: MessageBusClient,
    tools: Map<string, Tool>,
    sleepFn: (ms: number) => Promise<void> = sleep
  ) {
    this.credentialVault = credentialVault;
    this.messageBus = messageBus;
    this.tools = tools;
    this.sleepFn = sleepFn;
  }

  /**
   * Execute an external action with retry logic.
   * Retries up to 3 times with exponential backoff (1s, 4s, 16s).
   * Timeout: 30 seconds per attempt.
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    const startTime = Date.now();
    const timeout = request.timeout > 0 ? request.timeout : DEFAULT_TIMEOUT_MS;

    const tool = this.tools.get(request.toolName);
    if (!tool) {
      const result: ActionResult = {
        requestId: request.id,
        status: 'failure',
        duration: Date.now() - startTime,
        output: null,
        error: `Tool not found: ${request.toolName}`,
      };
      await this.publishResult(request, result);
      return result;
    }

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Wait for backoff delay before retry (not on first attempt)
      if (attempt > 0) {
        const delay = BACKOFF_DELAYS[attempt - 1];
        await this.sleepFn(delay);
      }

      try {
        const credential = await this.getCredential(request.agentId, request.toolName);
        const output = await withTimeout(
          tool.execute(request.params, credential),
          timeout
        );

        const result: ActionResult = {
          requestId: request.id,
          status: 'success',
          duration: Date.now() - startTime,
          output,
        };
        await this.publishResult(request, result);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // All retries exhausted
    const result: ActionResult = {
      requestId: request.id,
      status: 'failure',
      duration: Date.now() - startTime,
      output: null,
      error: lastError,
    };
    await this.publishResult(request, result);
    return result;
  }

  /**
   * Request a scoped credential from the vault (never stored locally).
   */
  private async getCredential(agentId: string, secretId: string): Promise<ScopedToken> {
    return this.credentialVault.getCredential(agentId, secretId);
  }

  /**
   * Publish action result to the message bus.
   */
  private async publishResult(request: ActionRequest, result: ActionResult): Promise<void> {
    await this.messageBus.publish(`responses:${request.id}`, {
      id: request.id,
      agent_id: request.agentId,
      status: result.status,
      duration: String(result.duration),
      output: JSON.stringify(result.output),
      timestamp: String(Date.now()),
      ...(result.error ? { error: result.error } : {}),
    });
  }
}
