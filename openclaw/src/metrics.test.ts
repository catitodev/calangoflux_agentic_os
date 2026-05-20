import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MetricsCollector,
  ThresholdAlerter,
  MetricValue,
  ThresholdConfig,
  TelegramNotifier,
} from './metrics.js';

// === MetricsCollector Tests ===

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('record', () => {
    it('should store a metric value', () => {
      const metric: MetricValue = {
        name: 'throughput',
        value: 100,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      collector.record(metric);

      const stored = collector.getMetrics('agent-1', 'throughput');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(metric);
    });

    it('should store multiple metrics for the same agent and type', () => {
      const now = Date.now();
      collector.record({ name: 'throughput', value: 10, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'throughput', value: 20, agentId: 'agent-1', timestamp: now + 1000 });

      const stored = collector.getMetrics('agent-1', 'throughput');
      expect(stored).toHaveLength(2);
    });

    it('should separate metrics by agent', () => {
      const now = Date.now();
      collector.record({ name: 'throughput', value: 10, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'throughput', value: 20, agentId: 'agent-2', timestamp: now });

      expect(collector.getMetrics('agent-1', 'throughput')).toHaveLength(1);
      expect(collector.getMetrics('agent-2', 'throughput')).toHaveLength(1);
    });

    it('should separate metrics by type', () => {
      const now = Date.now();
      collector.record({ name: 'throughput', value: 10, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'error_rate', value: 5, agentId: 'agent-1', timestamp: now });

      expect(collector.getMetrics('agent-1', 'throughput')).toHaveLength(1);
      expect(collector.getMetrics('agent-1', 'error_rate')).toHaveLength(1);
    });
  });

  describe('getLatency', () => {
    it('should return zeros when no latency data exists', () => {
      const result = collector.getLatency('agent-1');
      expect(result).toEqual({ p50: 0, p95: 0, p99: 0 });
    });

    it('should compute correct percentiles from latency samples', () => {
      const now = Date.now();
      // Record 100 latency samples: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        collector.record({
          name: 'latency_p50',
          value: i,
          agentId: 'agent-1',
          timestamp: now + i,
        });
      }

      const result = collector.getLatency('agent-1');
      expect(result.p50).toBe(50);
      expect(result.p95).toBe(95);
      expect(result.p99).toBe(99);
    });

    it('should handle a single latency sample', () => {
      collector.record({
        name: 'latency_p50',
        value: 42,
        agentId: 'agent-1',
        timestamp: Date.now(),
      });

      const result = collector.getLatency('agent-1');
      expect(result.p50).toBe(42);
      expect(result.p95).toBe(42);
      expect(result.p99).toBe(42);
    });

    it('should aggregate samples from all latency metric types', () => {
      const now = Date.now();
      collector.record({ name: 'latency_p50', value: 10, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'latency_p95', value: 20, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'latency_p99', value: 30, agentId: 'agent-1', timestamp: now });

      const result = collector.getLatency('agent-1');
      // sorted: [10, 20, 30]
      expect(result.p50).toBe(20); // ceil(0.5*3)-1 = 1 → index 1 → 20
      expect(result.p95).toBe(30); // ceil(0.95*3)-1 = 2 → index 2 → 30
      expect(result.p99).toBe(30); // ceil(0.99*3)-1 = 2 → index 2 → 30
    });
  });

  describe('getThroughput', () => {
    it('should return 0 when no throughput data exists', () => {
      expect(collector.getThroughput('agent-1')).toBe(0);
    });

    it('should return the value for a single sample', () => {
      collector.record({
        name: 'throughput',
        value: 50,
        agentId: 'agent-1',
        timestamp: Date.now(),
      });

      expect(collector.getThroughput('agent-1')).toBe(50);
    });

    it('should compute messages/second over a time window', () => {
      const baseTs = 1000000;
      // 10 messages over 5 seconds = 2 msg/s each sample, total 20 messages / 5s = 4 msg/s
      collector.record({ name: 'throughput', value: 10, agentId: 'agent-1', timestamp: baseTs });
      collector.record({ name: 'throughput', value: 10, agentId: 'agent-1', timestamp: baseTs + 5000 });

      const result = collector.getThroughput('agent-1');
      expect(result).toBe(4); // 20 total / 5 seconds
    });

    it('should sum values when all timestamps are identical', () => {
      const now = Date.now();
      collector.record({ name: 'throughput', value: 5, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'throughput', value: 3, agentId: 'agent-1', timestamp: now });

      expect(collector.getThroughput('agent-1')).toBe(8);
    });
  });

  describe('getErrorRate', () => {
    it('should return 0 when no error rate data exists', () => {
      expect(collector.getErrorRate('agent-1')).toBe(0);
    });

    it('should return the average error rate', () => {
      const now = Date.now();
      collector.record({ name: 'error_rate', value: 10, agentId: 'agent-1', timestamp: now });
      collector.record({ name: 'error_rate', value: 20, agentId: 'agent-1', timestamp: now + 1000 });
      collector.record({ name: 'error_rate', value: 30, agentId: 'agent-1', timestamp: now + 2000 });

      expect(collector.getErrorRate('agent-1')).toBe(20); // (10+20+30)/3
    });

    it('should return exact value for a single sample', () => {
      collector.record({
        name: 'error_rate',
        value: 5.5,
        agentId: 'agent-1',
        timestamp: Date.now(),
      });

      expect(collector.getErrorRate('agent-1')).toBe(5.5);
    });
  });

  describe('clear', () => {
    it('should remove all stored metrics', () => {
      collector.record({ name: 'throughput', value: 10, agentId: 'agent-1', timestamp: Date.now() });
      collector.record({ name: 'error_rate', value: 5, agentId: 'agent-2', timestamp: Date.now() });

      collector.clear();

      expect(collector.getMetrics('agent-1', 'throughput')).toHaveLength(0);
      expect(collector.getMetrics('agent-2', 'error_rate')).toHaveLength(0);
    });
  });
});

// === ThresholdAlerter Tests ===

describe('ThresholdAlerter', () => {
  let alerter: ThresholdAlerter;

  beforeEach(() => {
    alerter = new ThresholdAlerter();
  });

  describe('configure', () => {
    it('should accept threshold configurations', () => {
      const thresholds: ThresholdConfig[] = [
        { metric: 'error_rate', threshold: 5, comparison: 'gt' },
        { metric: 'throughput', threshold: 10, comparison: 'lt' },
      ];

      // Should not throw
      alerter.configure(thresholds);
    });
  });

  describe('check - greater than comparison', () => {
    it('should return alert when value exceeds threshold', () => {
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 10,
        agentId: 'agent-1',
        timestamp: 1700000000000,
      };

      const alert = alerter.check(metric);

      expect(alert).not.toBeNull();
      expect(alert!.metric).toBe('error_rate');
      expect(alert!.value).toBe(10);
      expect(alert!.threshold).toBe(5);
      expect(alert!.agentId).toBe('agent-1');
      expect(alert!.timestamp).toBe(1700000000000);
    });

    it('should return null when value equals threshold (no false positive)', () => {
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 5,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      expect(alerter.check(metric)).toBeNull();
    });

    it('should return null when value is below threshold', () => {
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 3,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      expect(alerter.check(metric)).toBeNull();
    });
  });

  describe('check - less than comparison', () => {
    it('should return alert when value is below threshold', () => {
      alerter.configure([{ metric: 'throughput', threshold: 10, comparison: 'lt' }]);

      const metric: MetricValue = {
        name: 'throughput',
        value: 5,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      const alert = alerter.check(metric);
      expect(alert).not.toBeNull();
      expect(alert!.value).toBe(5);
      expect(alert!.threshold).toBe(10);
    });

    it('should return null when value equals threshold (no false positive)', () => {
      alerter.configure([{ metric: 'throughput', threshold: 10, comparison: 'lt' }]);

      const metric: MetricValue = {
        name: 'throughput',
        value: 10,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      expect(alerter.check(metric)).toBeNull();
    });

    it('should return null when value is above threshold', () => {
      alerter.configure([{ metric: 'throughput', threshold: 10, comparison: 'lt' }]);

      const metric: MetricValue = {
        name: 'throughput',
        value: 15,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      expect(alerter.check(metric)).toBeNull();
    });
  });

  describe('check - no matching threshold', () => {
    it('should return null when no threshold matches the metric type', () => {
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'throughput',
        value: 100,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      expect(alerter.check(metric)).toBeNull();
    });

    it('should return null when no thresholds are configured', () => {
      const metric: MetricValue = {
        name: 'error_rate',
        value: 100,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      expect(alerter.check(metric)).toBeNull();
    });
  });

  describe('check - multiple thresholds', () => {
    it('should check against the first matching threshold', () => {
      alerter.configure([
        { metric: 'error_rate', threshold: 5, comparison: 'gt' },
        { metric: 'error_rate', threshold: 10, comparison: 'gt' },
      ]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 7,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      const alert = alerter.check(metric);
      expect(alert).not.toBeNull();
      expect(alert!.threshold).toBe(5); // First matching threshold
    });
  });

  describe('Telegram notification', () => {
    it('should call notifier when alert is triggered', () => {
      const notifier: TelegramNotifier = {
        sendAlert: vi.fn().mockResolvedValue(undefined),
      };

      alerter.setNotifier(notifier);
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 10,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      const alert = alerter.check(metric);

      expect(notifier.sendAlert).toHaveBeenCalledTimes(1);
      expect(notifier.sendAlert).toHaveBeenCalledWith(alert);
    });

    it('should not call notifier when no alert is triggered', () => {
      const notifier: TelegramNotifier = {
        sendAlert: vi.fn().mockResolvedValue(undefined),
      };

      alerter.setNotifier(notifier);
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 3,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      alerter.check(metric);

      expect(notifier.sendAlert).not.toHaveBeenCalled();
    });

    it('should work without a notifier configured', () => {
      alerter.configure([{ metric: 'error_rate', threshold: 5, comparison: 'gt' }]);

      const metric: MetricValue = {
        name: 'error_rate',
        value: 10,
        agentId: 'agent-1',
        timestamp: Date.now(),
      };

      // Should not throw
      const alert = alerter.check(metric);
      expect(alert).not.toBeNull();
    });
  });
});
