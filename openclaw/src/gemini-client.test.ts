import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RateLimiter,
  CircuitBreaker,
  CircuitState,
  GeminiClient,
  type GeminiApiAdapter,
  type GeminiConfig,
  type Message,
  type UserNotification,
  DEFAULT_GEMINI_CONFIG,
} from './gemini-client.js';

// === RateLimiter Tests ===

describe('RateLimiter', () => {
  it('allows requests within minute limit', () => {
    const limiter = new RateLimiter(15, 1000);
    const now = Date.now();

    for (let i = 0; i < 15; i++) {
      expect(limiter.canProceed(now)).toBe(true);
      limiter.recordRequest(now);
    }

    expect(limiter.canProceed(now)).toBe(false);
  });

  it('allows requests within day limit', () => {
    const limiter = new RateLimiter(1000, 5);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      expect(limiter.canProceed(now)).toBe(true);
      limiter.recordRequest(now);
    }

    expect(limiter.canProceed(now)).toBe(false);
  });

  it('resets minute window after 60 seconds', () => {
    const limiter = new RateLimiter(15, 1000);
    const now = Date.now();

    for (let i = 0; i < 15; i++) {
      limiter.recordRequest(now);
    }

    expect(limiter.canProceed(now)).toBe(false);
    expect(limiter.canProceed(now + 61_000)).toBe(true);
  });

  it('resets day window after 24 hours', () => {
    const limiter = new RateLimiter(1000, 5);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      limiter.recordRequest(now);
    }

    expect(limiter.canProceed(now)).toBe(false);
    expect(limiter.canProceed(now + 24 * 60 * 60 * 1000 + 1)).toBe(true);
  });

  it('calculates correct wait time when minute limit reached', () => {
    const limiter = new RateLimiter(15, 1000);
    const now = 1000000;

    for (let i = 0; i < 15; i++) {
      limiter.recordRequest(now);
    }

    const waitTime = limiter.getWaitTime(now + 30_000);
    // Oldest request was at `now`, so it expires at now + 60000
    // At now + 30000, wait = (now + 60000) - (now + 30000) = 30000
    expect(waitTime).toBe(30_000);
  });

  it('returns 0 wait time when under limit', () => {
    const limiter = new RateLimiter(15, 1000);
    expect(limiter.getWaitTime()).toBe(0);
  });

  it('reports correct usage stats', () => {
    const limiter = new RateLimiter(15, 1000);
    const now = Date.now();

    limiter.recordRequest(now);
    limiter.recordRequest(now);
    limiter.recordRequest(now);

    const usage = limiter.getUsage(now);
    expect(usage.minuteCount).toBe(3);
    expect(usage.dayCount).toBe(3);
  });

  it('manages queue correctly', () => {
    const limiter = new RateLimiter(15, 1000);

    expect(limiter.getQueueLength()).toBe(0);

    const request = {
      sessionId: 'test',
      message: 'hello',
      resolve: vi.fn(),
      reject: vi.fn(),
    };

    limiter.enqueue(request);
    expect(limiter.getQueueLength()).toBe(1);

    const dequeued = limiter.dequeue();
    expect(dequeued).toBe(request);
    expect(limiter.getQueueLength()).toBe(0);
  });
});

// === CircuitBreaker Tests ===

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe(CircuitState.Closed);
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after 5 consecutive failures', () => {
    const cb = new CircuitBreaker(5, 30_000);
    const now = Date.now();

    for (let i = 0; i < 4; i++) {
      cb.recordFailure(now);
      expect(cb.getState()).toBe(CircuitState.Closed);
    }

    cb.recordFailure(now);
    expect(cb.getState()).toBe(CircuitState.Open);
    expect(cb.canExecute(now)).toBe(false);
  });

  it('transitions to half-open after recovery time', () => {
    const cb = new CircuitBreaker(5, 30_000);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      cb.recordFailure(now);
    }

    expect(cb.canExecute(now)).toBe(false);
    expect(cb.canExecute(now + 30_000)).toBe(true);
    expect(cb.getState()).toBe(CircuitState.HalfOpen);
  });

  it('closes on success after half-open', () => {
    const cb = new CircuitBreaker(5, 30_000);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      cb.recordFailure(now);
    }

    // Transition to half-open
    cb.canExecute(now + 30_000);
    expect(cb.getState()).toBe(CircuitState.HalfOpen);

    cb.recordSuccess();
    expect(cb.getState()).toBe(CircuitState.Closed);
    expect(cb.getFailureCount()).toBe(0);
  });

  it('resets failure count on success', () => {
    const cb = new CircuitBreaker(5, 30_000);

    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getFailureCount()).toBe(3);

    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe(CircuitState.Closed);
  });

  it('stays open before recovery time elapses', () => {
    const cb = new CircuitBreaker(5, 30_000);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      cb.recordFailure(now);
    }

    expect(cb.canExecute(now + 15_000)).toBe(false);
    expect(cb.getState()).toBe(CircuitState.Open);
  });
});

// === GeminiClient Tests ===

describe('GeminiClient', () => {
  let mockAdapter: GeminiApiAdapter;
  let config: GeminiConfig;
  let client: GeminiClient;

  beforeEach(() => {
    mockAdapter = {
      sendRequest: vi.fn().mockImplementation((_messages: Message[], stream: boolean) => {
        if (stream) {
          return (async function* () {
            yield 'Hello';
            yield ' World';
          })();
        }
        return Promise.resolve('Hello World');
      }),
    } as unknown as GeminiApiAdapter;

    config = {
      apiKey: 'test-api-key',
      ...DEFAULT_GEMINI_CONFIG,
    };

    client = new GeminiClient(config, mockAdapter);
  });

  describe('sendMessage', () => {
    it('sends a message and returns response', async () => {
      const response = await client.sendMessage('session-1', 'Hello');
      expect(response).toBe('Hello World');
    });

    it('creates a session on first message', async () => {
      await client.sendMessage('session-1', 'Hello');
      const session = client.getSession('session-1');
      expect(session).toBeDefined();
      expect(session!.messages.length).toBe(2); // user + assistant
      expect(session!.messages[0].role).toBe('user');
      expect(session!.messages[1].role).toBe('assistant');
    });

    it('maintains conversation context across messages', async () => {
      await client.sendMessage('session-1', 'First');
      await client.sendMessage('session-1', 'Second');

      const session = client.getSession('session-1');
      expect(session!.messages.length).toBe(4); // 2 user + 2 assistant
    });

    it('evicts oldest messages when context exceeds 50', async () => {
      // Use a high rate limit to avoid queuing
      const highLimitConfig: GeminiConfig = { apiKey: 'test', maxRequestsPerMinute: 100, maxRequestsPerDay: 10000 };
      const highLimitClient = new GeminiClient(highLimitConfig, mockAdapter);

      // Fill up to 50 messages (25 user + 25 assistant)
      for (let i = 0; i < 25; i++) {
        await highLimitClient.sendMessage('session-1', `Message ${i}`);
      }

      const session = highLimitClient.getSession('session-1');
      expect(session!.messages.length).toBe(50);

      // Send one more — should evict oldest
      await highLimitClient.sendMessage('session-1', 'Overflow message');
      expect(session!.messages.length).toBe(50);
      // The first user message should have been evicted
      expect(session!.messages[0].content).not.toBe('Message 0');
    });

    it('returns fallback when circuit breaker is open', async () => {
      const notifications: UserNotification[] = [];
      client.onNotification(n => notifications.push(n));

      // Open the circuit breaker
      const cb = client.getCircuitBreaker();
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }

      const response = await client.sendMessage('session-1', 'Hello');
      expect(response).toBe('AI service is temporarily unavailable. Please try again later.');
      expect(notifications.some(n => n.type === 'unavailable')).toBe(true);
    });

    it('returns cached response as fallback when available', async () => {
      // First, get a successful response to populate cache
      await client.sendMessage('session-1', 'Hello');

      // Open the circuit breaker
      const cb = client.getCircuitBreaker();
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }

      const notifications: UserNotification[] = [];
      client.onNotification(n => notifications.push(n));

      const response = await client.sendMessage('session-1', 'Another message');
      expect(response).toBe('Hello World');
      expect(notifications.some(n => n.type === 'fallback')).toBe(true);
    });

    it('notifies user of delay when rate limited', async () => {
      const notifications: UserNotification[] = [];
      client.onNotification(n => notifications.push(n));

      // Exhaust rate limit
      const rl = client.getRateLimiter();
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        rl.recordRequest(now);
      }

      // This will queue the request — we don't await it to avoid blocking
      const promise = client.sendMessage('session-1', 'Hello');

      // Give the queue processor a tick to notify
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(notifications.some(n => n.type === 'delay')).toBe(true);

      // Clean up: resolve the promise by advancing time
      // (In real tests we'd use fake timers, but for unit test we just verify notification)
      // Cancel the pending promise to avoid hanging
      void promise.catch(() => { /* expected */ });
    });

    it('handles API errors gracefully with fallback', async () => {
      const failingAdapter: GeminiApiAdapter = {
        sendRequest: vi.fn().mockRejectedValue(new Error('API Error')),
      } as unknown as GeminiApiAdapter;

      const failClient = new GeminiClient(config, failingAdapter);
      const response = await failClient.sendMessage('session-1', 'Hello');
      expect(response).toBe('AI service is temporarily unavailable. Please try again later.');
    });
  });

  describe('streamResponse', () => {
    it('streams response chunks', async () => {
      const chunks: string[] = [];
      for await (const chunk of client.streamResponse('session-1', 'Hello')) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(['Hello', ' World']);
    });

    it('adds messages to context after streaming', async () => {
      const chunks: string[] = [];
      for await (const chunk of client.streamResponse('session-1', 'Hello')) {
        chunks.push(chunk);
      }

      const session = client.getSession('session-1');
      expect(session!.messages.length).toBe(2);
      expect(session!.messages[0].role).toBe('user');
      expect(session!.messages[1].role).toBe('assistant');
      expect(session!.messages[1].content).toBe('Hello World');
    });

    it('yields fallback when circuit breaker is open', async () => {
      const cb = client.getCircuitBreaker();
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }

      const chunks: string[] = [];
      for await (const chunk of client.streamResponse('session-1', 'Hello')) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('AI service is temporarily unavailable. Please try again later.');
    });

    it('yields fallback on API error during streaming', async () => {
      const failingAdapter: GeminiApiAdapter = {
        sendRequest: vi.fn().mockImplementation((_messages: Message[], stream: boolean) => {
          if (stream) {
            return (async function* () {
              throw new Error('Stream error');
            })();
          }
          return Promise.reject(new Error('API Error'));
        }),
      } as unknown as GeminiApiAdapter;

      const failClient = new GeminiClient(config, failingAdapter);
      const chunks: string[] = [];
      for await (const chunk of failClient.streamResponse('session-1', 'Hello')) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain('unavailable');
    });
  });

  describe('context window management', () => {
    it('enforces max 50 messages per session', async () => {
      // Use a high rate limit to avoid queuing
      const highLimitConfig: GeminiConfig = { apiKey: 'test', maxRequestsPerMinute: 100, maxRequestsPerDay: 10000 };
      const highLimitClient = new GeminiClient(highLimitConfig, mockAdapter);

      for (let i = 0; i < 30; i++) {
        await highLimitClient.sendMessage('session-1', `Message ${i}`);
      }

      const session = highLimitClient.getSession('session-1');
      // 30 user + 30 assistant = 60, but capped at 50
      expect(session!.messages.length).toBeLessThanOrEqual(50);
    });

    it('uses FIFO eviction (oldest messages removed first)', async () => {
      // Use a high rate limit to avoid queuing
      const highLimitConfig: GeminiConfig = { apiKey: 'test', maxRequestsPerMinute: 100, maxRequestsPerDay: 10000 };
      const highLimitClient = new GeminiClient(highLimitConfig, mockAdapter);

      for (let i = 0; i < 26; i++) {
        await highLimitClient.sendMessage('session-1', `Message ${i}`);
      }

      const session = highLimitClient.getSession('session-1');
      expect(session!.messages.length).toBe(50);

      // The oldest messages should have been evicted
      const firstMessage = session!.messages[0];
      expect(firstMessage.content).not.toBe('Message 0');
    });

    it('maintains separate contexts per session', async () => {
      await client.sendMessage('session-1', 'Hello from session 1');
      await client.sendMessage('session-2', 'Hello from session 2');

      const session1 = client.getSession('session-1');
      const session2 = client.getSession('session-2');

      expect(session1!.sessionId).toBe('session-1');
      expect(session2!.sessionId).toBe('session-2');
      expect(session1!.messages[0].content).toBe('Hello from session 1');
      expect(session2!.messages[0].content).toBe('Hello from session 2');
    });
  });

  describe('DEFAULT_GEMINI_CONFIG', () => {
    it('has correct default values', () => {
      expect(DEFAULT_GEMINI_CONFIG.maxRequestsPerMinute).toBe(15);
      expect(DEFAULT_GEMINI_CONFIG.maxRequestsPerDay).toBe(1000);
    });
  });
});
