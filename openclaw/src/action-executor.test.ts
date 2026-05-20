import { describe, it, expect, vi } from 'vitest';
import {
  ActionExecutor,
  ActionRequest,
  CredentialVaultClient,
  MessageBusClient,
  ScopedToken,
  Tool,
} from './action-executor.js';

// === Test Helpers ===

function createMockCredentialVault(
  token: ScopedToken = { token: 'scoped-token-123', expiresAt: Date.now() + 300_000, scope: ['read'] }
): CredentialVaultClient {
  return {
    getCredential: vi.fn().mockResolvedValue(token),
  };
}

function createMockMessageBus(): MessageBusClient & { publish: ReturnType<typeof vi.fn> } {
  return {
    publish: vi.fn().mockResolvedValue('msg-id-1'),
  };
}

function createMockTool(
  name: string,
  executeFn: (params: Record<string, unknown>, credential: ScopedToken) => Promise<unknown>
): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    execute: executeFn,
  };
}

function createRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    id: 'req-001',
    agentId: 'agent-alpha',
    toolName: 'web_search',
    params: { query: 'test' },
    timeout: 30_000,
    ...overrides,
  };
}

// Instant sleep for tests
const instantSleep = () => Promise.resolve();

// === Tests ===

describe('ActionExecutor', () => {
  describe('execute - success path', () => {
    it('should execute a tool successfully on first attempt', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => ({ results: ['result1'] }));
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      const result = await executor.execute(request);

      expect(result.status).toBe('success');
      expect(result.requestId).toBe('req-001');
      expect(result.output).toEqual({ results: ['result1'] });
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should request credential from vault before executing tool', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async (_params, credential) => {
        return { token: credential.token };
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      await executor.execute(request);

      expect(vault.getCredential).toHaveBeenCalledWith('agent-alpha', 'web_search');
    });

    it('should publish result to message bus on success', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => 'done');
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      await executor.execute(request);

      expect(bus.publish).toHaveBeenCalledTimes(1);
      const [stream, fields] = bus.publish.mock.calls[0];
      expect(stream).toBe('responses:req-001');
      expect(fields.status).toBe('success');
      expect(fields.agent_id).toBe('agent-alpha');
      expect(fields.id).toBe('req-001');
      expect(Number(fields.duration)).toBeGreaterThanOrEqual(0);
      expect(fields.output).toBe(JSON.stringify('done'));
    });
  });

  describe('execute - failure and retry', () => {
    it('should return failure when tool is not found', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tools = new Map<string, Tool>();

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest({ toolName: 'nonexistent_tool' });

      const result = await executor.execute(request);

      expect(result.status).toBe('failure');
      expect(result.error).toBe('Tool not found: nonexistent_tool');
    });

    it('should retry up to 3 times on failure then report failure', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      let callCount = 0;
      const tool = createMockTool('web_search', async () => {
        callCount++;
        throw new Error(`Attempt ${callCount} failed`);
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      const result = await executor.execute(request);

      expect(result.status).toBe('failure');
      expect(callCount).toBe(4); // 1 initial + 3 retries
      expect(result.error).toBe('Attempt 4 failed');
    });

    it('should succeed on retry if tool recovers', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      let callCount = 0;
      const tool = createMockTool('web_search', async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient failure');
        }
        return 'recovered';
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      const result = await executor.execute(request);

      expect(result.status).toBe('success');
      expect(result.output).toBe('recovered');
      expect(callCount).toBe(3); // failed twice, succeeded on 3rd
    });

    it('should apply exponential backoff delays (1s, 4s, 16s)', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const delays: number[] = [];
      const mockSleep = async (ms: number) => { delays.push(ms); };
      const tool = createMockTool('web_search', async () => {
        throw new Error('always fails');
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, mockSleep);
      const request = createRequest();

      await executor.execute(request);

      expect(delays).toEqual([1_000, 4_000, 16_000]);
    });

    it('should publish failure result to message bus after retries exhausted', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => {
        throw new Error('persistent error');
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      await executor.execute(request);

      expect(bus.publish).toHaveBeenCalledTimes(1);
      const [stream, fields] = bus.publish.mock.calls[0];
      expect(stream).toBe('responses:req-001');
      expect(fields.status).toBe('failure');
      expect(fields.error).toBe('persistent error');
    });
  });

  describe('execute - timeout', () => {
    it('should timeout if tool execution exceeds timeout duration', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => {
        // Simulate a long-running operation
        return new Promise((resolve) => setTimeout(resolve, 60_000));
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest({ timeout: 50 }); // 50ms timeout for test speed

      const result = await executor.execute(request);

      expect(result.status).toBe('failure');
      expect(result.error).toContain('timed out');
    });

    it('should use default 30s timeout when timeout is 0', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => 'fast');
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest({ timeout: 0 });

      const result = await executor.execute(request);

      // Should succeed since the tool is fast
      expect(result.status).toBe('success');
    });
  });

  describe('execute - credential handling', () => {
    it('should fail if credential vault rejects the request', async () => {
      const vault: CredentialVaultClient = {
        getCredential: vi.fn().mockRejectedValue(new Error('Unauthorized')),
      };
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => 'should not reach');
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      const result = await executor.execute(request);

      // Should fail after retries since credential always fails
      expect(result.status).toBe('failure');
      expect(result.error).toBe('Unauthorized');
    });

    it('should never store credentials locally - requests fresh token each attempt', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      let callCount = 0;
      const tool = createMockTool('web_search', async () => {
        callCount++;
        if (callCount < 2) throw new Error('retry');
        return 'ok';
      });
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      await executor.execute(request);

      // Credential should be requested fresh for each attempt
      expect(vault.getCredential).toHaveBeenCalledTimes(2);
    });
  });

  describe('execute - result publication', () => {
    it('should include duration in milliseconds in published result', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => 'result');
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      await executor.execute(request);

      const [, fields] = bus.publish.mock.calls[0];
      const duration = Number(fields.duration);
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(typeof fields.duration).toBe('string'); // serialized as string for Redis
    });

    it('should include output payload in published result', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => ({ data: [1, 2, 3] }));
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest();

      await executor.execute(request);

      const [, fields] = bus.publish.mock.calls[0];
      expect(JSON.parse(fields.output)).toEqual({ data: [1, 2, 3] });
    });

    it('should publish to stream named responses:{requestId}', async () => {
      const vault = createMockCredentialVault();
      const bus = createMockMessageBus();
      const tool = createMockTool('web_search', async () => null);
      const tools = new Map<string, Tool>([['web_search', tool]]);

      const executor = new ActionExecutor(vault, bus, tools, instantSleep);
      const request = createRequest({ id: 'req-xyz-789' });

      await executor.execute(request);

      const [stream] = bus.publish.mock.calls[0];
      expect(stream).toBe('responses:req-xyz-789');
    });
  });
});
