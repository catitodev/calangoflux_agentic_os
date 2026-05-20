/**
 * Miscellaneous Tools — webhook_trigger, translate
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const webhookTrigger: Tool = {
  name: 'webhook_trigger',
  description: 'Trigger a webhook by sending a POST request to a URL with a JSON payload.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const url = params['url'];

    if (typeof url !== 'string' || url.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "url" is required and must be a non-empty string.' };
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return { success: false, data: null, error: 'Parameter "url" must be a valid URL.' };
    }

    const payload = typeof params['payload'] === 'object' && params['payload'] !== null
      ? params['payload']
      : {};

    const headers = typeof params['headers'] === 'object' && params['headers'] !== null
      ? params['headers'] as Record<string, string>
      : {};

    // Stub: returns mock webhook trigger result
    return {
      success: true,
      data: {
        url,
        payload,
        headers,
        statusCode: 200,
        responseBody: { received: true },
        status: 'triggered',
      },
    };
  },
};

export const translate: Tool = {
  name: 'translate',
  description: 'Translate text from one language to another.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const text = params['text'];
    const targetLanguage = params['targetLanguage'];

    if (typeof text !== 'string' || text.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "text" is required and must be a non-empty string.' };
    }
    if (typeof targetLanguage !== 'string' || targetLanguage.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "targetLanguage" is required and must be a non-empty string (e.g., "en", "pt", "es").' };
    }

    const sourceLanguage = typeof params['sourceLanguage'] === 'string' ? params['sourceLanguage'] : 'auto';

    // Stub: returns mock translation result
    return {
      success: true,
      data: {
        originalText: text,
        translatedText: `[Translated to ${targetLanguage}]: ${text}`,
        sourceLanguage,
        targetLanguage,
        confidence: 0.95,
      },
    };
  },
};
