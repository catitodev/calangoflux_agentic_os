/**
 * Communication Tools — email_send, telegram_send, slack_send, whatsapp_send
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const emailSend: Tool = {
  name: 'email_send',
  description: 'Send an email to a recipient with subject and body.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const to = params['to'];
    const subject = params['subject'];
    const body = params['body'];

    if (typeof to !== 'string' || to.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "to" is required and must be a non-empty string.' };
    }
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "subject" is required and must be a non-empty string.' };
    }
    if (typeof body !== 'string' || body.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "body" is required and must be a non-empty string.' };
    }

    // Stub: returns mock email send result
    return {
      success: true,
      data: {
        messageId: `msg_${Date.now()}`,
        to,
        subject,
        status: 'sent',
      },
    };
  },
};

export const telegramSend: Tool = {
  name: 'telegram_send',
  description: 'Send a message to a Telegram chat or user.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const chatId = params['chatId'];
    const message = params['message'];

    if (typeof chatId !== 'string' || chatId.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "chatId" is required and must be a non-empty string.' };
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "message" is required and must be a non-empty string.' };
    }

    // Stub: returns mock Telegram send result
    return {
      success: true,
      data: {
        messageId: Math.floor(Math.random() * 1000000),
        chatId,
        text: message,
        status: 'delivered',
      },
    };
  },
};

export const slackSend: Tool = {
  name: 'slack_send',
  description: 'Send a message to a Slack channel or user.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const channel = params['channel'];
    const message = params['message'];

    if (typeof channel !== 'string' || channel.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "channel" is required and must be a non-empty string.' };
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "message" is required and must be a non-empty string.' };
    }

    // Stub: returns mock Slack send result
    return {
      success: true,
      data: {
        ts: `${Date.now()}.000100`,
        channel,
        text: message,
        status: 'sent',
      },
    };
  },
};

export const whatsappSend: Tool = {
  name: 'whatsapp_send',
  description: 'Send a WhatsApp message to a phone number.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const phone = params['phone'];
    const message = params['message'];

    if (typeof phone !== 'string' || phone.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "phone" is required and must be a non-empty string.' };
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "message" is required and must be a non-empty string.' };
    }

    // Stub: returns mock WhatsApp send result
    return {
      success: true,
      data: {
        messageId: `wamid_${Date.now()}`,
        phone,
        text: message,
        status: 'sent',
      },
    };
  },
};
