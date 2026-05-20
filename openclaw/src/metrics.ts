/**
 * Metrics collection and threshold alerting for CalangoFlux Agentic OS.
 * Provides throughput, latency percentiles, error rate tracking, and
 * configurable threshold-based alerting with optional Telegram notification.
 */

// === Types ===

export type MetricType =
  | 'throughput'
  | 'latency_p50'
  | 'latency_p95'
  | 'latency_p99'
  | 'error_rate'
  | 'resource_utilization';

export interface MetricValue {
  name: MetricType;
  value: number;
  agentId: string;
  timestamp: number;
}

export interface ThresholdConfig {
  metric: MetricType;
  threshold: number;
  comparison: 'gt' | 'lt';
}

export interface Alert {
  metric: MetricType;
  value: number;
  threshold: number;
  agentId: string;
  timestamp: number;
}

/**
 * Interface for Telegram notification (optional integration).
 * Consumers can implement this to receive critical alerts via Telegram.
 */
export interface TelegramNotifier {
  sendAlert(alert: Alert): Promise<void>;
}

// === MetricsCollector ===

export class MetricsCollector {
  private metrics: Map<string, MetricValue[]> = new Map();

  /**
   * Record a metric value. Stored per agentId for later aggregation.
   */
  record(metric: MetricValue): void {
    const key = `${metric.agentId}:${metric.name}`;
    const existing = this.metrics.get(key) ?? [];
    existing.push(metric);
    this.metrics.set(key, existing);
  }

  /**
   * Compute latency percentiles (p50, p95, p99) for a given agent.
   * Uses all recorded latency metrics (latency_p50, latency_p95, latency_p99)
   * as raw latency samples.
   */
  getLatency(agentId: string): { p50: number; p95: number; p99: number } {
    const samples = this.getLatencySamples(agentId);

    if (samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);

    return {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }

  /**
   * Compute throughput (messages/second) for a given agent.
   * Calculated as total messages divided by the time window (first to last timestamp).
   */
  getThroughput(agentId: string): number {
    const key = `${agentId}:throughput`;
    const values = this.metrics.get(key) ?? [];

    if (values.length === 0) {
      return 0;
    }

    if (values.length === 1) {
      return values[0].value;
    }

    const timestamps = values.map((v) => v.timestamp);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const windowSeconds = (maxTs - minTs) / 1000;

    if (windowSeconds <= 0) {
      // All samples at same timestamp — sum values as instantaneous rate
      return values.reduce((sum, v) => sum + v.value, 0);
    }

    const totalMessages = values.reduce((sum, v) => sum + v.value, 0);
    return totalMessages / windowSeconds;
  }

  /**
   * Compute error rate (percentage) for a given agent.
   * Returns the average of all recorded error_rate values.
   */
  getErrorRate(agentId: string): number {
    const key = `${agentId}:error_rate`;
    const values = this.metrics.get(key) ?? [];

    if (values.length === 0) {
      return 0;
    }

    const sum = values.reduce((acc, v) => acc + v.value, 0);
    return sum / values.length;
  }

  /**
   * Get all stored metrics for a given agent and metric type.
   */
  getMetrics(agentId: string, metricType: MetricType): MetricValue[] {
    const key = `${agentId}:${metricType}`;
    return this.metrics.get(key) ?? [];
  }

  /**
   * Clear all stored metrics.
   */
  clear(): void {
    this.metrics.clear();
  }

  private getLatencySamples(agentId: string): number[] {
    const latencyTypes: MetricType[] = ['latency_p50', 'latency_p95', 'latency_p99'];
    const samples: number[] = [];

    for (const type of latencyTypes) {
      const key = `${agentId}:${type}`;
      const values = this.metrics.get(key) ?? [];
      for (const v of values) {
        samples.push(v.value);
      }
    }

    return samples;
  }
}

// === ThresholdAlerter ===

export class ThresholdAlerter {
  private thresholds: ThresholdConfig[] = [];
  private notifier: TelegramNotifier | null = null;

  /**
   * Configure threshold rules for alerting.
   */
  configure(thresholds: ThresholdConfig[]): void {
    this.thresholds = [...thresholds];
  }

  /**
   * Set an optional Telegram notifier for critical alerts.
   */
  setNotifier(notifier: TelegramNotifier): void {
    this.notifier = notifier;
  }

  /**
   * Check a metric value against configured thresholds.
   * Returns an Alert if the threshold is exceeded, null otherwise.
   * No false positives: only alerts when the threshold is strictly exceeded.
   */
  check(metric: MetricValue): Alert | null {
    for (const config of this.thresholds) {
      if (config.metric !== metric.name) {
        continue;
      }

      const exceeded = this.isThresholdExceeded(metric.value, config);

      if (exceeded) {
        const alert: Alert = {
          metric: metric.name,
          value: metric.value,
          threshold: config.threshold,
          agentId: metric.agentId,
          timestamp: metric.timestamp,
        };

        // Fire-and-forget Telegram notification if configured
        if (this.notifier) {
          void this.notifier.sendAlert(alert);
        }

        return alert;
      }
    }

    return null;
  }

  private isThresholdExceeded(value: number, config: ThresholdConfig): boolean {
    switch (config.comparison) {
      case 'gt':
        return value > config.threshold;
      case 'lt':
        return value < config.threshold;
    }
  }
}

// === Utility Functions ===

/**
 * Compute the p-th percentile from a sorted array of numbers.
 * Uses nearest-rank method.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}
