/**
 * Tool Interface — Contract for all OpenClaw tool integrations.
 *
 * Each tool implements this interface to provide a consistent execution model.
 * Real API integrations will be wired later; implementations validate params
 * and return structured mock results.
 */

/** Scoped credential token provided by IronClaw's Credential Vault */
export interface ScopedToken {
  token: string;
  expiresAt: number; // Unix timestamp, max 5 minutes TTL
  scope: string[];
}

/** Result returned by a tool execution */
export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

/** Core Tool interface — all tools must implement this */
export interface Tool {
  /** Unique tool identifier (e.g., 'web_search', 'email_send') */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /**
   * Execute the tool with the given parameters and credential.
   * Implementations validate params and perform the action.
   * @param params - Tool-specific parameters
   * @param credential - Scoped token for API authentication
   * @returns Promise resolving to a ToolResult
   */
  execute(params: Record<string, unknown>, credential: ScopedToken): Promise<ToolResult>;
}
