/**
 * OpenClaw Tool Library — 20+ tool integrations with a unified registry.
 *
 * Exports the Tool interface and ToolRegistry class that manages
 * all available tools for the Action Executor.
 */

export type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

// Re-export individual tools for direct access
export { webSearch, httpRequest } from './web.js';
export { emailSend, telegramSend, slackSend, whatsappSend } from './communication.js';
export { linkedinPost, instagramPost } from './social.js';
export { fileRead, fileWrite, pdfGenerate, imageResize } from './files.js';
export { dbQuery, dbInsert, spreadsheetRead, spreadsheetWrite } from './database.js';
export { calendarCreate, calendarList } from './calendar.js';
export { webhookTrigger, translate } from './misc.js';

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';
import { webSearch, httpRequest } from './web.js';
import { emailSend, telegramSend, slackSend, whatsappSend } from './communication.js';
import { linkedinPost, instagramPost } from './social.js';
import { fileRead, fileWrite, pdfGenerate, imageResize } from './files.js';
import { dbQuery, dbInsert, spreadsheetRead, spreadsheetWrite } from './database.js';
import { calendarCreate, calendarList } from './calendar.js';
import { webhookTrigger, translate } from './misc.js';

/**
 * ToolRegistry manages all available tools and provides lookup/execution.
 *
 * Tools are registered at startup and can be retrieved by name for execution.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaults();
  }

  /** Register all built-in tools */
  private registerDefaults(): void {
    const defaultTools: Tool[] = [
      // Web
      webSearch,
      httpRequest,
      // Communication
      emailSend,
      telegramSend,
      slackSend,
      whatsappSend,
      // Social
      linkedinPost,
      instagramPost,
      // Files
      fileRead,
      fileWrite,
      pdfGenerate,
      imageResize,
      // Database
      dbQuery,
      dbInsert,
      spreadsheetRead,
      spreadsheetWrite,
      // Calendar
      calendarCreate,
      calendarList,
      // Misc
      webhookTrigger,
      translate,
    ];

    for (const tool of defaultTools) {
      this.register(tool);
    }
  }

  /** Register a tool in the registry */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** Unregister a tool by name */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get a tool by name, or undefined if not found */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool is registered */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** List all registered tool names */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** List all registered tools with their descriptions */
  listTools(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  /** Get the total number of registered tools */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Execute a tool by name with the given params and credential.
   * @throws Error if tool is not found
   */
  async execute(
    toolName: string,
    params: Record<string, unknown>,
    credential: ScopedToken,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        data: null,
        error: `Tool "${toolName}" not found in registry. Available tools: ${this.listNames().join(', ')}`,
      };
    }
    return tool.execute(params, credential);
  }
}
