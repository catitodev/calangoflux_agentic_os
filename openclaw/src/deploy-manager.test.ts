import { describe, it, expect, vi } from 'vitest';
import {
  DeployManager,
  DeployConfig,
  CloudRunClient,
} from './deploy-manager.js';

// === Test Helpers ===

function createMockClient(overrides: Partial<CloudRunClient> = {}): CloudRunClient {
  return {
    deploy: vi.fn().mockResolvedValue(undefined),
    getHealth: vi.fn().mockResolvedValue(true),
    rollback: vi.fn().mockResolvedValue(undefined),
    listVersions: vi.fn().mockResolvedValue([]),
    deleteVersion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    serviceName: 'openclaw',
    imageTag: 'v1.2.0-abc123',
    healthCheckUrl: 'https://openclaw.run.app/health',
    healthCheckTimeout: 60_000,
    maxVersionsRetained: 3,
    ...overrides,
  };
}

const instantSleep = () => Promise.resolve();

// === Tests ===

describe('DeployManager', () => {
  describe('atomicDeploy - success path', () => {
    it('should deploy new version and return success when health check passes', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v1.1.0-prev']),
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig();

      const result = await manager.atomicDeploy(config);

      expect(result.success).toBe(true);
      expect(result.serviceName).toBe('openclaw');
      expect(result.imageTag).toBe('v1.2.0-abc123');
      expect(result.previousTag).toBe('v1.1.0-prev');
      expect(result.rollbackTriggered).toBe(false);
    });

    it('should call deploy with correct service and tag', async () => {
      const client = createMockClient({
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig();

      await manager.atomicDeploy(config);

      expect(client.deploy).toHaveBeenCalledWith('openclaw', 'v1.2.0-abc123');
    });

    it('should check health after deploying', async () => {
      const client = createMockClient({
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig();

      await manager.atomicDeploy(config);

      expect(client.getHealth).toHaveBeenCalledWith('https://openclaw.run.app/health');
    });

    it('should set previousTag to undefined when no previous versions exist', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue([]),
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig();

      const result = await manager.atomicDeploy(config);

      expect(result.previousTag).toBeUndefined();
    });
  });

  describe('atomicDeploy - rollback on health failure', () => {
    it('should rollback when health check fails within timeout', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v1.1.0-prev']),
        getHealth: vi.fn().mockResolvedValue(false),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ healthCheckTimeout: 50 });

      const result = await manager.atomicDeploy(config);

      expect(result.success).toBe(false);
      expect(result.rollbackTriggered).toBe(true);
      expect(client.rollback).toHaveBeenCalledWith('openclaw', 'v1.1.0-prev');
    });

    it('should not call rollback when no previous version exists', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue([]),
        getHealth: vi.fn().mockResolvedValue(false),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ healthCheckTimeout: 50 });

      const result = await manager.atomicDeploy(config);

      expect(result.success).toBe(false);
      expect(result.rollbackTriggered).toBe(true);
      expect(client.rollback).not.toHaveBeenCalled();
    });

    it('should return rollbackTriggered true even without previous version', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue([]),
        getHealth: vi.fn().mockResolvedValue(false),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ healthCheckTimeout: 50 });

      const result = await manager.atomicDeploy(config);

      expect(result.rollbackTriggered).toBe(true);
    });
  });

  describe('atomicDeploy - version retention', () => {
    it('should retain only maxVersionsRetained versions after successful deploy', async () => {
      const client = createMockClient({
        listVersions: vi
          .fn()
          .mockResolvedValueOnce(['v1.3.0', 'v1.2.0', 'v1.1.0']) // before deploy
          .mockResolvedValueOnce(['v1.4.0', 'v1.3.0', 'v1.2.0', 'v1.1.0']), // after deploy
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ imageTag: 'v1.4.0', maxVersionsRetained: 3 });

      await manager.atomicDeploy(config);

      expect(client.deleteVersion).toHaveBeenCalledWith('openclaw', 'v1.1.0');
    });

    it('should not delete versions when count is within limit', async () => {
      const client = createMockClient({
        listVersions: vi
          .fn()
          .mockResolvedValueOnce(['v1.1.0']) // before deploy
          .mockResolvedValueOnce(['v1.2.0', 'v1.1.0']), // after deploy
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ imageTag: 'v1.2.0', maxVersionsRetained: 3 });

      await manager.atomicDeploy(config);

      expect(client.deleteVersion).not.toHaveBeenCalled();
    });

    it('should not call retainVersions when deploy fails', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v1.1.0']),
        getHealth: vi.fn().mockResolvedValue(false),
      });
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ healthCheckTimeout: 50 });

      await manager.atomicDeploy(config);

      expect(client.deleteVersion).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('should rollback to previous version when multiple versions exist', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v1.3.0', 'v1.2.0', 'v1.1.0']),
      });
      const manager = new DeployManager(client, instantSleep);

      const result = await manager.rollback('openclaw');

      expect(result.success).toBe(true);
      expect(result.imageTag).toBe('v1.2.0');
      expect(result.previousTag).toBe('v1.3.0');
      expect(result.rollbackTriggered).toBe(true);
      expect(client.rollback).toHaveBeenCalledWith('openclaw', 'v1.2.0');
    });

    it('should fail when only one version exists (nothing to rollback to)', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v1.1.0']),
      });
      const manager = new DeployManager(client, instantSleep);

      const result = await manager.rollback('openclaw');

      expect(result.success).toBe(false);
      expect(result.rollbackTriggered).toBe(false);
      expect(client.rollback).not.toHaveBeenCalled();
    });

    it('should fail when no versions exist', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue([]),
      });
      const manager = new DeployManager(client, instantSleep);

      const result = await manager.rollback('openclaw');

      expect(result.success).toBe(false);
      expect(result.rollbackTriggered).toBe(false);
    });
  });

  describe('retainVersions', () => {
    it('should delete oldest versions when count exceeds max', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v4', 'v3', 'v2', 'v1']),
      });
      const manager = new DeployManager(client, instantSleep);

      await manager.retainVersions('openclaw', 3);

      expect(client.deleteVersion).toHaveBeenCalledTimes(1);
      expect(client.deleteVersion).toHaveBeenCalledWith('openclaw', 'v1');
    });

    it('should delete multiple old versions when far over limit', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v6', 'v5', 'v4', 'v3', 'v2', 'v1']),
      });
      const manager = new DeployManager(client, instantSleep);

      await manager.retainVersions('openclaw', 3);

      expect(client.deleteVersion).toHaveBeenCalledTimes(3);
      expect(client.deleteVersion).toHaveBeenCalledWith('openclaw', 'v3');
      expect(client.deleteVersion).toHaveBeenCalledWith('openclaw', 'v2');
      expect(client.deleteVersion).toHaveBeenCalledWith('openclaw', 'v1');
    });

    it('should not delete anything when at or below limit', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue(['v3', 'v2', 'v1']),
      });
      const manager = new DeployManager(client, instantSleep);

      await manager.retainVersions('openclaw', 3);

      expect(client.deleteVersion).not.toHaveBeenCalled();
    });

    it('should not delete anything when empty', async () => {
      const client = createMockClient({
        listVersions: vi.fn().mockResolvedValue([]),
      });
      const manager = new DeployManager(client, instantSleep);

      await manager.retainVersions('openclaw', 3);

      expect(client.deleteVersion).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('should return true immediately when health check passes on first poll', async () => {
      const client = createMockClient({
        getHealth: vi.fn().mockResolvedValue(true),
      });
      const manager = new DeployManager(client, instantSleep);

      const result = await manager.healthCheck('https://service/health', 60_000);

      expect(result).toBe(true);
      expect(client.getHealth).toHaveBeenCalledTimes(1);
    });

    it('should retry polling until healthy within timeout', async () => {
      let callCount = 0;
      const client = createMockClient({
        getHealth: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount >= 3; // healthy on 3rd attempt
        }),
      });
      const manager = new DeployManager(client, instantSleep);

      const result = await manager.healthCheck('https://service/health', 60_000);

      expect(result).toBe(true);
      expect(callCount).toBe(3);
    });

    it('should return false when health check never passes within timeout', async () => {
      const client = createMockClient({
        getHealth: vi.fn().mockResolvedValue(false),
      });
      const manager = new DeployManager(client, instantSleep);

      const result = await manager.healthCheck('https://service/health', 50);

      expect(result).toBe(false);
    });

    it('should poll at regular intervals', async () => {
      const sleepCalls: number[] = [];
      const mockSleep = async (ms: number) => { sleepCalls.push(ms); };
      let callCount = 0;
      const client = createMockClient({
        getHealth: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount >= 3;
        }),
      });
      const manager = new DeployManager(client, mockSleep);

      await manager.healthCheck('https://service/health', 60_000);

      // Should have slept between polls (2 sleeps for 3 calls)
      expect(sleepCalls.length).toBe(2);
      expect(sleepCalls[0]).toBeLessThanOrEqual(2_000);
      expect(sleepCalls[1]).toBeLessThanOrEqual(2_000);
    });
  });

  describe('atomicDeploy - full flow integration', () => {
    it('should perform complete deploy flow: list → deploy → health → retain', async () => {
      const callOrder: string[] = [];
      const client: CloudRunClient = {
        listVersions: vi.fn().mockImplementation(async () => {
          callOrder.push('listVersions');
          return ['v1.0.0'];
        }),
        deploy: vi.fn().mockImplementation(async () => {
          callOrder.push('deploy');
        }),
        getHealth: vi.fn().mockImplementation(async () => {
          callOrder.push('getHealth');
          return true;
        }),
        rollback: vi.fn().mockImplementation(async () => {
          callOrder.push('rollback');
        }),
        deleteVersion: vi.fn().mockImplementation(async () => {
          callOrder.push('deleteVersion');
        }),
      };
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig();

      await manager.atomicDeploy(config);

      // Verify order: listVersions (get previous) → deploy → getHealth → listVersions (retain check)
      expect(callOrder[0]).toBe('listVersions');
      expect(callOrder[1]).toBe('deploy');
      expect(callOrder[2]).toBe('getHealth');
      expect(callOrder[3]).toBe('listVersions');
    });

    it('should perform rollback flow: list → deploy → health(fail) → rollback', async () => {
      const callOrder: string[] = [];
      const client: CloudRunClient = {
        listVersions: vi.fn().mockImplementation(async () => {
          callOrder.push('listVersions');
          return ['v1.0.0'];
        }),
        deploy: vi.fn().mockImplementation(async () => {
          callOrder.push('deploy');
        }),
        getHealth: vi.fn().mockImplementation(async () => {
          callOrder.push('getHealth');
          return false;
        }),
        rollback: vi.fn().mockImplementation(async () => {
          callOrder.push('rollback');
        }),
        deleteVersion: vi.fn().mockImplementation(async () => {
          callOrder.push('deleteVersion');
        }),
      };
      const manager = new DeployManager(client, instantSleep);
      const config = createConfig({ healthCheckTimeout: 50 });

      const result = await manager.atomicDeploy(config);

      expect(result.success).toBe(false);
      expect(result.rollbackTriggered).toBe(true);
      expect(callOrder).toContain('rollback');
      expect(callOrder).not.toContain('deleteVersion');
    });
  });
});
