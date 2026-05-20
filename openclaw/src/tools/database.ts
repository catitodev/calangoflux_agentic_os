/**
 * Database Tools — db_query, db_insert, spreadsheet_read, spreadsheet_write
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const dbQuery: Tool = {
  name: 'db_query',
  description: 'Execute a read-only SQL query against a database.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const query = params['query'];

    if (typeof query !== 'string' || query.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "query" is required and must be a non-empty string.' };
    }

    // Basic safety check: reject write operations in a read-only tool
    const upperQuery = query.toUpperCase().trim();
    if (upperQuery.startsWith('INSERT') || upperQuery.startsWith('UPDATE') || upperQuery.startsWith('DELETE') || upperQuery.startsWith('DROP')) {
      return { success: false, data: null, error: 'db_query is read-only. Use db_insert for write operations.' };
    }

    const database = typeof params['database'] === 'string' ? params['database'] : 'default';

    // Stub: returns mock query result
    return {
      success: true,
      data: {
        database,
        query,
        rows: [],
        rowCount: 0,
        executionTimeMs: 12,
      },
    };
  },
};

export const dbInsert: Tool = {
  name: 'db_insert',
  description: 'Insert one or more records into a database table.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const table = params['table'];
    const records = params['records'];

    if (typeof table !== 'string' || table.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "table" is required and must be a non-empty string.' };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return { success: false, data: null, error: 'Parameter "records" is required and must be a non-empty array.' };
    }

    const database = typeof params['database'] === 'string' ? params['database'] : 'default';

    // Stub: returns mock insert result
    return {
      success: true,
      data: {
        database,
        table,
        insertedCount: records.length,
        status: 'inserted',
      },
    };
  },
};

export const spreadsheetRead: Tool = {
  name: 'spreadsheet_read',
  description: 'Read data from a spreadsheet (Google Sheets or Excel file).',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const spreadsheetId = params['spreadsheetId'];

    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "spreadsheetId" is required and must be a non-empty string.' };
    }

    const sheet = typeof params['sheet'] === 'string' ? params['sheet'] : 'Sheet1';
    const range = typeof params['range'] === 'string' ? params['range'] : 'A1:Z100';

    // Stub: returns mock spreadsheet data
    return {
      success: true,
      data: {
        spreadsheetId,
        sheet,
        range,
        values: [],
        rowCount: 0,
        columnCount: 0,
      },
    };
  },
};

export const spreadsheetWrite: Tool = {
  name: 'spreadsheet_write',
  description: 'Write data to a spreadsheet (Google Sheets or Excel file).',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const spreadsheetId = params['spreadsheetId'];
    const values = params['values'];

    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "spreadsheetId" is required and must be a non-empty string.' };
    }
    if (!Array.isArray(values) || values.length === 0) {
      return { success: false, data: null, error: 'Parameter "values" is required and must be a non-empty array of rows.' };
    }

    const sheet = typeof params['sheet'] === 'string' ? params['sheet'] : 'Sheet1';
    const range = typeof params['range'] === 'string' ? params['range'] : 'A1';

    // Stub: returns mock spreadsheet write result
    return {
      success: true,
      data: {
        spreadsheetId,
        sheet,
        range,
        updatedRows: values.length,
        status: 'written',
      },
    };
  },
};
