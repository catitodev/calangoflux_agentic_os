/**
 * Web Tools — web_search, http_request
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const webSearch: Tool = {
  name: 'web_search',
  description: 'Search the web using a query string and return relevant results.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const query = params['query'];
    if (typeof query !== 'string' || query.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "query" is required and must be a non-empty string.' };
    }

    const maxResults = typeof params['maxResults'] === 'number' ? params['maxResults'] : 10;

    // Stub: returns mock search results
    return {
      success: true,
      data: {
        query,
        maxResults,
        results: [
          { title: `Result for "${query}"`, url: `https://example.com/search?q=${encodeURIComponent(query)}`, snippet: 'Mock search result snippet.' },
        ],
      },
    };
  },
};

export const httpRequest: Tool = {
  name: 'http_request',
  description: 'Make an HTTP request to a specified URL with configurable method, headers, and body.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const url = params['url'];
    if (typeof url !== 'string' || url.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "url" is required and must be a non-empty string.' };
    }

    const method = typeof params['method'] === 'string' ? params['method'].toUpperCase() : 'GET';
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(method)) {
      return { success: false, data: null, error: `Invalid HTTP method "${method}". Must be one of: ${validMethods.join(', ')}` };
    }

    // Stub: returns mock HTTP response
    return {
      success: true,
      data: {
        url,
        method,
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { message: 'Mock HTTP response' },
      },
    };
  },
};
