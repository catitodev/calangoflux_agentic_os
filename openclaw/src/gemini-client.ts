/**
 * Gemini Client — CalangoFlux Agentic OS
 *
 * Google AI Studio API integration with:
 * - Rate limiting (15 req/min, 1000 req/day) with request queuing
 * - Circuit breaker (open after 5 failures, recover after 30s)
 * - Context window management (max 50 messages per session, FIFO eviction)
 * - Streaming responses via async generator
 * - Fallback: cached response or user notification when API unavailable
 */

// === Configuration ===

export interface GeminiConfig {
  apiKey: string;
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
}

export const DEFAULT_GEMINI_CONFIG: Omit<GeminiConfig, 'apiKey'> = {
  maxRequestsPerMinute: 15,
  maxRequestsPerDay: 1000,
};

// === Message Types ===

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ConversationContext {
  sessionId: string;
  messages: Message[];
  maxMessages: number;
}

// === Rate Limiter ===

interface QueuedRequest {
  sessionId: string;
  message: string;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

export class RateLimiter {
  private minuteTimestamps: number[] = [];
  private dayTimestamps: number[] = [];
  private readonly maxPerMinute: number;
  private readonly maxPerDay: number;
  private queue: QueuedRequest[] = [];
  private processing = false;

  constructor(maxPerMinute: number, maxPerDay: number) {
    this.maxPerMinute = maxPerMinute;
    this.maxPerDay = maxPerDay;
  }

  /**
   * Check if a request can proceed immediately.
   */
  canProceed(now: number = Date.now()): boolean {
    this.pruneTimestamps(now);
    return (
      this.minuteTimestamps.length < this.maxPerMinute &&
      this.dayTimestamps.length < this.maxPerDay
    );
  }

  /**
   * Record a request timestamp.
   */
  recordRequest(now: number = Date.now()): void {
    this.minuteTimestamps.push(now);
    this.dayTimestamps.push(now);
  }

  /**
   * Get the time until the next request can proceed (in ms).
   * Returns 0 if a request can proceed now.
   */
  getWaitTime(now: number = Date.now()): number {
    this.pruneTimestamps(now);

    if (this.dayTimestamps.length >= this.maxPerDay) {
      const oldestDay = this.dayTimestamps[0];
      return oldestDay + 24 * 60 * 60 * 1000 - now;
    }

    if (this.minuteTimestamps.length >= this.maxPerMinute) {
      const oldestMinute = this.minuteTimestamps[0];
      return oldestMinute + 60 * 1000 - now;
    }

    return 0;
  }

  /**
   * Enqueue a request to be processed when quota is available.
   */
  enqueue(request: QueuedRequest): void {
    this.queue.push(request);
  }

  /**
   * Get the current queue length.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Dequeue the next request if available.
   */
  dequeue(): QueuedRequest | undefined {
    return this.queue.shift();
  }

  /**
   * Check if the queue is being processed.
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Set the processing state.
   */
  setProcessing(value: boolean): void {
    this.processing = value;
  }

  /**
   * Remove timestamps outside their respective windows.
   */
  private pruneTimestamps(now: number): void {
    const oneMinuteAgo = now - 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    this.minuteTimestamps = this.minuteTimestamps.filter(t => t > oneMinuteAgo);
    this.dayTimestamps = this.dayTimestamps.filter(t => t > oneDayAgo);
  }

  /**
   * Get current usage stats.
   */
  getUsage(now: number = Date.now()): { minuteCount: number; dayCount: number } {
    this.pruneTimestamps(now);
    return {
      minuteCount: this.minuteTimestamps.length,
      dayCount: this.dayTimestamps.length,
    };
  }
}

// === Circuit Breaker ===

export enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half-open',
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly recoveryTimeMs: number;

  constructor(failureThreshold = 5, recoveryTimeMs = 30_000) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
  }

  /**
   * Check if the circuit allows a request to pass.
   */
  canExecute(now: number = Date.now()): boolean {
    switch (this.state) {
      case CircuitState.Closed:
        return true;
      case CircuitState.Open:
        if (now - this.lastFailureTime >= this.recoveryTimeMs) {
          this.state = CircuitState.HalfOpen;
          return true;
        }
        return false;
      case CircuitState.HalfOpen:
        return true;
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.Closed;
  }

  /**
   * Record a failed request.
   */
  recordFailure(now: number = Date.now()): void {
    this.failureCount++;
    this.lastFailureTime = now;

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.Open;
    }
  }

  /**
   * Get the current circuit state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get the current failure count.
   */
  getFailureCount(): number {
    return this.failureCount;
  }
}

// === Notification Types ===

export interface UserNotification {
  type: 'delay' | 'unavailable' | 'fallback';
  message: string;
  estimatedWaitMs?: number;
}

export type NotificationCallback = (notification: UserNotification) => void;

// === Gemini Client ===

export interface GeminiApiAdapter {
  sendRequest(messages: Message[], stream: false): Promise<string>;
  sendRequest(messages: Message[], stream: true): AsyncGenerator<string, void, unknown>;
  sendRequest(
    messages: Message[],
    stream: boolean
  ): Promise<string> | AsyncGenerator<string, void, unknown>;
}

export class GeminiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly sessions: Map<string, ConversationContext> = new Map();
  private readonly responseCache: Map<string, string> = new Map();
  private readonly apiAdapter: GeminiApiAdapter;
  private notificationCallback?: NotificationCallback;

  constructor(config: GeminiConfig, apiAdapter: GeminiApiAdapter) {
    this.rateLimiter = new RateLimiter(
      config.maxRequestsPerMinute,
      config.maxRequestsPerDay
    );
    this.circuitBreaker = new CircuitBreaker(5, 30_000);
    this.apiAdapter = apiAdapter;
  }

  /**
   * Set a callback for user notifications (delay, unavailable, fallback).
   */
  onNotification(callback: NotificationCallback): void {
    this.notificationCallback = callback;
  }

  /**
   * Send a message in a conversation session.
   * Rate-limited with queuing when quota is exhausted.
   */
  async sendMessage(sessionId: string, message: string): Promise<string> {
    const context = this.getOrCreateSession(sessionId);
    this.addMessage(context, { role: 'user', content: message, timestamp: Date.now() });

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      return this.handleFallback(sessionId, message);
    }

    // Check rate limit
    if (!this.rateLimiter.canProceed()) {
      const waitTime = this.rateLimiter.getWaitTime();
      this.notify({
        type: 'delay',
        message: `Rate limit reached. Request queued. Estimated wait: ${Math.ceil(waitTime / 1000)}s`,
        estimatedWaitMs: waitTime,
      });

      return new Promise<string>((resolve, reject) => {
        this.rateLimiter.enqueue({ sessionId, message, resolve, reject });
        this.processQueue();
      });
    }

    return this.executeRequest(context);
  }

  /**
   * Stream a response as an async generator.
   * Rate-limited with queuing when quota is exhausted.
   */
  async *streamResponse(sessionId: string, message: string): AsyncGenerator<string, void, unknown> {
    const context = this.getOrCreateSession(sessionId);
    this.addMessage(context, { role: 'user', content: message, timestamp: Date.now() });

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      const fallback = this.handleFallback(sessionId, message);
      yield fallback;
      return;
    }

    // Check rate limit — for streaming, we wait inline
    if (!this.rateLimiter.canProceed()) {
      const waitTime = this.rateLimiter.getWaitTime();
      this.notify({
        type: 'delay',
        message: `Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s for quota refresh.`,
        estimatedWaitMs: waitTime,
      });
      await this.delay(waitTime);
    }

    this.rateLimiter.recordRequest();

    try {
      const generator = this.apiAdapter.sendRequest(context.messages, true);
      let fullResponse = '';

      for await (const chunk of generator) {
        fullResponse += chunk;
        yield chunk;
      }

      this.circuitBreaker.recordSuccess();
      this.addMessage(context, {
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
      });
      this.responseCache.set(sessionId, fullResponse);
    } catch (_error: unknown) {
      this.circuitBreaker.recordFailure();
      const fallback = this.handleFallback(sessionId, message);
      yield fallback;
    }
  }

  /**
   * Get the conversation context for a session.
   */
  getSession(sessionId: string): ConversationContext | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get the rate limiter instance (for testing/monitoring).
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Get the circuit breaker instance (for testing/monitoring).
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  // === Private Methods ===

  private getOrCreateSession(sessionId: string): ConversationContext {
    let context = this.sessions.get(sessionId);
    if (!context) {
      context = {
        sessionId,
        messages: [],
        maxMessages: 50,
      };
      this.sessions.set(sessionId, context);
    }
    return context;
  }

  /**
   * Add a message to the context, evicting the oldest if at capacity (FIFO).
   */
  private addMessage(context: ConversationContext, message: Message): void {
    if (context.messages.length >= context.maxMessages) {
      context.messages.shift();
    }
    context.messages.push(message);
  }

  private async executeRequest(context: ConversationContext): Promise<string> {
    this.rateLimiter.recordRequest();

    try {
      const response = await this.apiAdapter.sendRequest(context.messages, false);
      this.circuitBreaker.recordSuccess();
      this.addMessage(context, {
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      });
      this.responseCache.set(context.sessionId, response);
      return response;
    } catch (_error: unknown) {
      this.circuitBreaker.recordFailure();
      return this.handleFallback(context.sessionId, context.messages[context.messages.length - 1]?.content ?? '');
    }
  }

  private handleFallback(sessionId: string, _message: string): string {
    const cached = this.responseCache.get(sessionId);
    if (cached) {
      this.notify({
        type: 'fallback',
        message: 'AI service temporarily unavailable. Showing cached response.',
      });
      return cached;
    }

    this.notify({
      type: 'unavailable',
      message: 'AI service is temporarily unavailable. Please try again later.',
    });
    return 'AI service is temporarily unavailable. Please try again later.';
  }

  private async processQueue(): Promise<void> {
    if (this.rateLimiter.isProcessing()) return;
    this.rateLimiter.setProcessing(true);

    try {
      while (this.rateLimiter.getQueueLength() > 0) {
        const waitTime = this.rateLimiter.getWaitTime();
        if (waitTime > 0) {
          await this.delay(waitTime);
        }

        const request = this.rateLimiter.dequeue();
        if (!request) break;

        const context = this.getOrCreateSession(request.sessionId);
        try {
          const response = await this.executeRequest(context);
          request.resolve(response);
        } catch (error: unknown) {
          request.reject(error);
        }
      }
    } finally {
      this.rateLimiter.setProcessing(false);
    }
  }

  private notify(notification: UserNotification): void {
    if (this.notificationCallback) {
      this.notificationCallback(notification);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
