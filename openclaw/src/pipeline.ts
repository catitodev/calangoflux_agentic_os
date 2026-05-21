/**
 * OpenClaw Pipeline — Wires all OpenClaw components together.
 *
 * Connects:
 * - ActionExecutor with ToolRegistry
 * - GeminiClient with config from env vars
 * - LeadDetector
 * - Message bus consumer reading from Redis Streams "tasks:action" consumer group "openclaw-workers"
 * - On message: execute action via ActionExecutor, detect leads, publish result
 */

import Redis from 'ioredis';
import { ActionExecutor } from './action-executor.js';
import type { ActionRequest, CredentialVaultClient, MessageBusClient, ScopedToken } from './action-executor.js';
import { GeminiClient, DEFAULT_GEMINI_CONFIG } from './gemini-client.js';
import type { GeminiApiAdapter, Message } from './gemini-client.js';
import { LeadDetector } from './lead-detector.js';
import type { LeadStorage, LeadInfo } from './lead-detector.js';
import { ToolRegistry } from './tools/index.js';
import { Logger } from './logger.js';

// === Configuration ===

export interface PipelineConfig {
  redisUrl: string;
  geminiApiKey: string;
  port: number;
  consumerGroup: string;
  consumerName: string;
  streamKey: string;
  geminiStreamKey: string;
}

export function loadConfig(): PipelineConfig {
  return {
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
    port: parseInt(process.env['PORT'] ?? '8083', 10),
    consumerGroup: 'openclaw-workers',
    consumerName: `openclaw-${process.pid}`,
    streamKey: 'tasks:action',
    geminiStreamKey: 'tasks:gemini',
  };
}

// === Redis-backed MessageBusClient ===

export class RedisMessageBusClient implements MessageBusClient {
  constructor(private readonly redis: Redis) {}

  async publish(stream: string, fields: Record<string, string>): Promise<string> {
    const args: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      args.push(key, value);
    }
    const id = await this.redis.xadd(stream, '*', ...args);
    return id ?? '';
  }
}

// === Stub CredentialVaultClient (calls IronClaw in production) ===

export class RemoteCredentialVaultClient implements CredentialVaultClient {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async getCredential(agentId: string, secretId: string): Promise<ScopedToken> {
    // In production, this would call IronClaw's credential vault gRPC endpoint.
    // For now, return a placeholder scoped token.
    this.logger.info('Requesting credential from vault', { agentId, secretId });
    return {
      token: `scoped-token-${agentId}-${secretId}`,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
      scope: [secretId],
    };
  }
}

// === Stub LeadStorage (persists to Supabase in production) ===

export class RedisLeadStorage implements LeadStorage {
  private readonly redis: Redis;
  private readonly logger: Logger;

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.logger = logger;
  }

  async persistLead(lead: LeadInfo): Promise<string> {
    const leadId = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.redis.xadd('leads:detected', '*',
      'id', leadId,
      'contact', lead.contact,
      'interest', lead.interest,
      'conversation_id', lead.conversationId,
      'detected_at', lead.detectedAt.toISOString(),
    );
    this.logger.info('Lead persisted', { leadId, contact: lead.contact });
    return leadId;
  }

  async notifyAdmin(lead: LeadInfo): Promise<void> {
    await this.redis.xadd('alerts:leads', '*',
      'contact', lead.contact,
      'interest', lead.interest,
      'conversation_id', lead.conversationId,
      'timestamp', new Date().toISOString(),
    );
    this.logger.info('Admin notified of new lead', { contact: lead.contact });
  }
}

// === Stub GeminiApiAdapter ===

export class RemoteGeminiApiAdapter implements GeminiApiAdapter {
  private readonly apiKey: string;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.apiKey = apiKey;
    this.logger = logger;
  }

  sendRequest(messages: Message[], stream: false): Promise<string>;
  sendRequest(messages: Message[], stream: true): AsyncGenerator<string, void, unknown>;
  sendRequest(
    messages: Message[],
    stream: boolean,
  ): Promise<string> | AsyncGenerator<string, void, unknown> {
    if (stream) {
      return this.streamRequest(messages);
    }
    return this.nonStreamRequest(messages);
  }

  private async nonStreamRequest(messages: Message[]): Promise<string> {
    // In production, calls Google AI Studio API
    this.logger.info('Gemini request', { messageCount: messages.length });
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    // Placeholder: would call the actual API here
    return `Gemini response for ${messages.length} messages`;
  }

  private async *streamRequest(messages: Message[]): AsyncGenerator<string, void, unknown> {
    this.logger.info('Gemini stream request', { messageCount: messages.length });
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    // Placeholder: would stream from the actual API here
    yield `Gemini streamed response for ${messages.length} messages`;
  }
}

// === Pipeline ===

export interface Pipeline {
  actionExecutor: ActionExecutor;
  geminiClient: GeminiClient;
  leadDetector: LeadDetector;
  redis: Redis;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createPipeline(config: PipelineConfig): Pipeline {
  const logger = new Logger({ agentId: 'openclaw' });

  // Redis connection
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  // Message bus client
  const messageBus = new RedisMessageBusClient(redis);

  // Credential vault client
  const credentialVault = new RemoteCredentialVaultClient(logger);

  // Tool registry
  const toolRegistry = new ToolRegistry();

  // Build tools map for ActionExecutor (adapts ToolRegistry to the Map<string, Tool> interface)
  const toolsMap = new Map<string, { name: string; description: string; execute: (params: Record<string, unknown>, credential: ScopedToken) => Promise<unknown> }>();
  for (const toolInfo of toolRegistry.listTools()) {
    const tool = toolRegistry.get(toolInfo.name);
    if (tool) {
      toolsMap.set(tool.name, {
        name: tool.name,
        description: tool.description,
        execute: async (params, credential) => {
          const result = await tool.execute(params, credential);
          if (!result.success) {
            throw new Error(result.error ?? 'Tool execution failed');
          }
          return result.data;
        },
      });
    }
  }

  // Action executor
  const actionExecutor = new ActionExecutor(credentialVault, messageBus, toolsMap);

  // Gemini client
  const geminiAdapter = new RemoteGeminiApiAdapter(config.geminiApiKey, logger);
  const geminiClient = new GeminiClient(
    {
      apiKey: config.geminiApiKey,
      ...DEFAULT_GEMINI_CONFIG,
    },
    geminiAdapter,
  );

  // Lead detector
  const leadDetector = new LeadDetector();
  const leadStorage = new RedisLeadStorage(redis, logger);

  // Consumer loop state
  let running = false;

  async function ensureConsumerGroup(): Promise<void> {
    // Ensure consumer group for action stream
    try {
      await redis.xgroup('CREATE', config.streamKey, config.consumerGroup, '0', 'MKSTREAM');
      logger.info('Consumer group created', { stream: config.streamKey, group: config.consumerGroup });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) {
        throw err;
      }
      logger.info('Consumer group already exists', { stream: config.streamKey, group: config.consumerGroup });
    }

    // Ensure consumer group for gemini stream
    try {
      await redis.xgroup('CREATE', config.geminiStreamKey, config.consumerGroup, '0', 'MKSTREAM');
      logger.info('Consumer group created', { stream: config.geminiStreamKey, group: config.consumerGroup });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) {
        throw err;
      }
      logger.info('Consumer group already exists', { stream: config.geminiStreamKey, group: config.consumerGroup });
    }
  }

  async function consumeMessages(): Promise<void> {
    running = true;
    logger.info('Starting action message consumer', {
      stream: config.streamKey,
      group: config.consumerGroup,
      consumer: config.consumerName,
    });

    while (running) {
      try {
        const results = await redis.xreadgroup(
          'GROUP', config.consumerGroup, config.consumerName,
          'COUNT', '10',
          'BLOCK', '2000',
          'STREAMS', config.streamKey, '>',
        ) as [string, [string, string[]][]][] | null;

        if (!results) continue;

        for (const [, messages] of results) {
          for (const [messageId, fields] of messages) {
            await processMessage(messageId, fields);
          }
        }
      } catch (err: unknown) {
        if (!running) break;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Action consumer error', { error: message });
        // Brief pause before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async function consumeGeminiMessages(): Promise<void> {
    logger.info('Starting gemini message consumer', {
      stream: config.geminiStreamKey,
      group: config.consumerGroup,
      consumer: config.consumerName,
    });

    while (running) {
      try {
        const results = await redis.xreadgroup(
          'GROUP', config.consumerGroup, config.consumerName,
          'COUNT', '10',
          'BLOCK', '2000',
          'STREAMS', config.geminiStreamKey, '>',
        ) as [string, [string, string[]][]][] | null;

        if (!results) continue;

        for (const [, messages] of results) {
          for (const [messageId, fields] of messages) {
            await processGeminiMessage(messageId, fields);
          }
        }
      } catch (err: unknown) {
        if (!running) break;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Gemini consumer error', { error: message });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async function processMessage(messageId: string, fields: string[]): Promise<void> {
    // Parse fields array into key-value pairs
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    logger.info('Processing action message', { messageId, toolName: data['tool_name'] });

    try {
      // Build ActionRequest from message fields
      const request: ActionRequest = {
        id: data['id'] ?? messageId,
        agentId: data['agent_id'] ?? data['sender_id'] ?? 'unknown',
        toolName: data['tool_name'] ?? '',
        params: data['params'] ? JSON.parse(data['params']) as Record<string, unknown> : {},
        timeout: parseInt(data['timeout'] ?? '30000', 10),
      };

      // Execute action
      const result = await actionExecutor.execute(request);

      // Detect leads from the output (if it's a string response)
      if (result.status === 'success' && typeof result.output === 'string') {
        await leadDetector.processMessage(result.output, request.id, leadStorage);
      }

      // Also check the original message payload for leads
      if (data['payload']) {
        await leadDetector.processMessage(data['payload'], request.id, leadStorage);
      }

      // Publish result to response stream (Requirement 11.5)
      // Stream: responses:{request_id} — IronClaw reads this to deliver back to client
      const responseStream = `responses:${request.id}`;
      await messageBus.publish(responseStream, {
        id: request.id,
        agent_id: 'openclaw',
        status: result.status,
        output: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
        duration: String(result.duration),
        timestamp: String(Date.now()),
      });

      // Acknowledge message
      await redis.xack(config.streamKey, config.consumerGroup, messageId);

      logger.info('Action message processed', {
        messageId,
        status: result.status,
        duration: result.duration,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to process action message', { messageId, error: errorMsg });
      // Acknowledge to avoid reprocessing poison messages indefinitely
      await redis.xack(config.streamKey, config.consumerGroup, messageId);
    }
  }

  async function processGeminiMessage(messageId: string, fields: string[]): Promise<void> {
    // Parse fields array into key-value pairs
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    logger.info('Processing gemini message', { messageId, intent: data['intent'] });

    try {
      const requestId = data['id'] ?? messageId;
      const payload = data['payload'] ?? '';

      // Parse the payload to extract the user message
      let userMessage = payload;
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        if (typeof parsed['Payload'] === 'string') {
          userMessage = parsed['Payload'] as string;
        } else if (parsed['payload'] && typeof parsed['payload'] === 'string') {
          userMessage = parsed['payload'] as string;
        }
      } catch {
        // payload is plain text, use as-is
      }

      // Send to Gemini for conversation/analysis/research
      const response = await geminiClient.sendMessage(requestId, userMessage);

      // Detect leads from the Gemini response
      await leadDetector.processMessage(response, requestId, leadStorage);
      // Also check the original user message for leads
      await leadDetector.processMessage(userMessage, requestId, leadStorage);

      // Publish response to response stream
      const responseStream = `responses:${requestId}`;
      await messageBus.publish(responseStream, {
        id: requestId,
        agent_id: 'gemini',
        status: 'success',
        output: response,
        duration: '0',
        timestamp: String(Date.now()),
      });

      // Acknowledge message
      await redis.xack(config.geminiStreamKey, config.consumerGroup, messageId);

      logger.info('Gemini message processed', { messageId, responseLength: response.length });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to process gemini message', { messageId, error: errorMsg });

      // Publish error response
      const requestId = data['id'] ?? messageId;
      const responseStream = `responses:${requestId}`;
      await messageBus.publish(responseStream, {
        id: requestId,
        agent_id: 'gemini',
        status: 'failure',
        output: errorMsg,
        duration: '0',
        timestamp: String(Date.now()),
      });

      // Acknowledge to avoid reprocessing
      await redis.xack(config.geminiStreamKey, config.consumerGroup, messageId);
    }
  }

  return {
    actionExecutor,
    geminiClient,
    leadDetector,
    redis,
    logger,

    async start(): Promise<void> {
      await redis.connect();
      logger.info('Connected to Redis', { url: config.redisUrl });
      await ensureConsumerGroup();

      // Start action consumer in background (non-blocking)
      consumeMessages().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Action consumer loop crashed', { error: msg });
      });

      // Start gemini consumer in background (non-blocking)
      consumeGeminiMessages().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Gemini consumer loop crashed', { error: msg });
      });

      logger.info('Pipeline started — consuming from action and gemini streams');
    },

    async stop(): Promise<void> {
      running = false;
      await redis.quit();
      logger.info('Pipeline stopped');
    },
  };
}
