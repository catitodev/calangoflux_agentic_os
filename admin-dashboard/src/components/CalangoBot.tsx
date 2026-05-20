import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage, Message } from './ChatMessage';

/** API Gateway base URL — configurable via environment variable */
const API_BASE_URL = import.meta.env.VITE_API_GATEWAY_URL ?? '/api';

/** Polling interval for streaming simulation (ms) */
const POLL_INTERVAL_MS = 300;

/** Maximum retries before showing service unavailable */
const MAX_RETRIES = 2;

interface StreamingState {
  requestId: string;
  content: string;
  done: boolean;
}

/**
 * CalangoBot — Chat widget component for the CalangoFlux Agentic OS.
 *
 * Sends messages through the API Gateway which routes them through the
 * Agentic OS pipeline (PicoClaw → Gemini/OpenClaw). Displays streaming
 * responses via polling and falls back to a "service unavailable" message
 * when the Agentic OS is down.
 */
export const CalangoBot: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Scroll to bottom when messages change */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  /** Cleanup polling on unmount */
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  /**
   * Sends a message to the API Gateway and initiates response polling.
   */
  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    let retries = 0;

    while (retries <= MAX_RETRIES) {
      try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as { requestId: string };
        pollForResponse(data.requestId);
        return;
      } catch {
        retries++;
        if (retries > MAX_RETRIES) {
          handleServiceUnavailable();
          return;
        }
        // Wait before retry with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      }
    }
  }, []);

  /**
   * Polls the API Gateway for streaming response chunks.
   * Simulates streaming by periodically fetching response status.
   */
  const pollForResponse = (requestId: string) => {
    let accumulatedContent = '';

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/chat/response/${requestId}`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as StreamingState;
        accumulatedContent = data.content;

        // Update or add the assistant message
        setMessages((prev) => {
          const existingIdx = prev.findIndex(
            (m) => m.id === requestId && m.role === 'assistant'
          );

          const assistantMessage: Message = {
            id: requestId,
            role: 'assistant',
            content: accumulatedContent,
            timestamp: Date.now(),
          };

          if (existingIdx >= 0) {
            const updated = [...prev];
            updated[existingIdx] = assistantMessage;
            return updated;
          }
          return [...prev, assistantMessage];
        });

        if (data.done) {
          stopPolling();
          setIsTyping(false);
          setServiceAvailable(true);
        }
      } catch {
        stopPolling();
        handleServiceUnavailable();
      }
    }, POLL_INTERVAL_MS);
  };

  /** Stops the polling interval */
  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  /** Handles service unavailable state with fallback message */
  const handleServiceUnavailable = () => {
    setIsTyping(false);
    setServiceAvailable(false);

    const fallbackMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content:
        'Desculpe, o serviço está temporariamente indisponível. ' +
        'Por favor, tente novamente em alguns instantes.',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, fallbackMessage]);
  };

  /** Handles form submission */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isTyping) return;
    void sendMessage(trimmed);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '500px',
        width: '380px',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#4f46e5',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '18px' }}>🦎</span>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>CalangoBot</span>
        {!serviceAvailable && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '10px',
              backgroundColor: '#ef4444',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            Offline
          </span>
        )}
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          backgroundColor: '#ffffff',
        }}
      >
        {messages.length === 0 && (
          <p
            style={{
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: '13px',
              marginTop: '40px',
            }}
          >
            Olá! Como posso ajudar?
          </p>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {isTyping && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          padding: '10px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          gap: '8px',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Digite sua mensagem..."
          disabled={isTyping}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isTyping || !input.trim()}
          style={{
            padding: '8px 16px',
            backgroundColor:
              isTyping || !input.trim() ? '#9ca3af' : '#4f46e5',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            cursor: isTyping || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Enviar
        </button>
      </form>
    </div>
  );
};

/**
 * TypingIndicator — Animated dots shown while the assistant is generating a response.
 */
const TypingIndicator: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-start',
        marginBottom: '8px',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderRadius: '12px',
          backgroundColor: '#f3f4f6',
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          ● ● ●
        </span>
      </div>
    </div>
  );
};
