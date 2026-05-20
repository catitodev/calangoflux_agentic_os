/**
 * Calendar Tools — calendar_create, calendar_list
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const calendarCreate: Tool = {
  name: 'calendar_create',
  description: 'Create a new calendar event with title, time, and optional attendees.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const title = params['title'];
    const startTime = params['startTime'];
    const endTime = params['endTime'];

    if (typeof title !== 'string' || title.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "title" is required and must be a non-empty string.' };
    }
    if (typeof startTime !== 'string' || startTime.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "startTime" is required and must be a non-empty ISO 8601 string.' };
    }
    if (typeof endTime !== 'string' || endTime.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "endTime" is required and must be a non-empty ISO 8601 string.' };
    }

    // Validate that endTime is after startTime
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, data: null, error: 'Parameters "startTime" and "endTime" must be valid ISO 8601 date strings.' };
    }
    if (end <= start) {
      return { success: false, data: null, error: '"endTime" must be after "startTime".' };
    }

    const attendees = Array.isArray(params['attendees']) ? params['attendees'] : [];
    const description = typeof params['description'] === 'string' ? params['description'] : '';

    // Stub: returns mock calendar event creation result
    return {
      success: true,
      data: {
        eventId: `evt_${Date.now()}`,
        title,
        startTime,
        endTime,
        attendees,
        description,
        status: 'created',
      },
    };
  },
};

export const calendarList: Tool = {
  name: 'calendar_list',
  description: 'List calendar events within a date range.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const startDate = params['startDate'];
    const endDate = params['endDate'];

    if (typeof startDate !== 'string' || startDate.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "startDate" is required and must be a non-empty ISO 8601 string.' };
    }
    if (typeof endDate !== 'string' || endDate.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "endDate" is required and must be a non-empty ISO 8601 string.' };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, data: null, error: 'Parameters "startDate" and "endDate" must be valid ISO 8601 date strings.' };
    }

    const calendarId = typeof params['calendarId'] === 'string' ? params['calendarId'] : 'primary';

    // Stub: returns mock calendar events list
    return {
      success: true,
      data: {
        calendarId,
        startDate,
        endDate,
        events: [],
        totalCount: 0,
      },
    };
  },
};
