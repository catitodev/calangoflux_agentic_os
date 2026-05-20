/**
 * Deploy Manager — Atomic deployment with health-check rollback
 *
 * Implements:
 * - Atomic deploy: start new → verify health within 60s → route traffic → terminate old
 * - Automatic rollback if health checks fail within 60 seconds
 * - Version retention: keep last 3 versions, remove oldest when 4th deployed
 */

// === Types ===

export interface DeployConfig {
  serviceName: string;
  imageTag: string;
  healthCheckUrl: string;
  healthCheckTimeout: number; // milliseconds, default 60_000
  maxVersionsRetained: number; // default 3
}

export interface DeployResult {
  success: boolean;
  serviceName: string;
  imageTag: string;
  previousTag?: string;
  rollbackTriggered: boolean;
}

// === Cloud Run Client Interface ===

export interface CloudRunClient {
  /** Deploy a new revision of a service with the given image tag */
  deploy(service: string, tag: string): Promise<void>;
  /** Check health of a service at the given URL. Returns true if healthy. */
  getHealth(url: string): Promise<boolean>;
  /** Rollback a service to a previous image tag */
  rollback(service: string, previousTag: string): Promise<void>;
  /** List all deployed versions (image tags) for a service, ordered newest first */
  listVersions(service: string): Promise<string[]>;
  /** Delete a specific version (image tag) from the registry */
  deleteVersion(service: string, tag: string): Promise<void>;
}

// === Default constants ===

const DEFAULT_HEALTH_CHECK_TIMEOUT = 60_000; // 60 seconds
const DEFAULT_MAX_VERSIONS_RETAINED = 3;
const HEALTH_POLL_INTERVAL = 2_000; // 2 seconds between health polls

// === DeployManager ===

export class DeployManager {
  private client: CloudRunClient;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(
    client: CloudRunClient,
    sleepFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.client = client;
    this.sleepFn = sleepFn;
  }

  /**
   * Perform an atomic deployment:
   * 1. Get current versions to identify previous tag
   * 2. Deploy new version
   * 3. Verify health within timeout
   * 4. If health fails, rollback to previous version
   * 5. Retain only maxVersionsRetained versions
   */
  async atomicDeploy(config: DeployConfig): Promise<DeployResult> {
    const timeout = config.healthCheckTimeout || DEFAULT_HEALTH_CHECK_TIMEOUT;
    const maxVersions = config.maxVersionsRetained || DEFAULT_MAX_VERSIONS_RETAINED;

    // Get current versions to identify previous tag
    const currentVersions = await this.client.listVersions(config.serviceName);
    const previousTag = currentVersions.length > 0 ? currentVersions[0] : undefined;

    // Deploy new version
    await this.client.deploy(config.serviceName, config.imageTag);

    // Verify health within timeout
    const healthy = await this.healthCheck(config.healthCheckUrl, timeout);

    if (!healthy) {
      // Rollback if health check fails
      if (previousTag) {
        await this.client.rollback(config.serviceName, previousTag);
      }
      return {
        success: false,
        serviceName: config.serviceName,
        imageTag: config.imageTag,
        previousTag,
        rollbackTriggered: true,
      };
    }

    // Retain only maxVersions versions (new tag is now deployed)
    await this.retainVersions(config.serviceName, maxVersions);

    return {
      success: true,
      serviceName: config.serviceName,
      imageTag: config.imageTag,
      previousTag,
      rollbackTriggered: false,
    };
  }

  /**
   * Rollback a service to its previous version.
   * Used when health checks fail within 60 seconds.
   */
  async rollback(service: string): Promise<DeployResult> {
    const versions = await this.client.listVersions(service);

    if (versions.length < 2) {
      return {
        success: false,
        serviceName: service,
        imageTag: versions[0] ?? '',
        rollbackTriggered: false,
      };
    }

    const currentTag = versions[0];
    const previousTag = versions[1];

    await this.client.rollback(service, previousTag);

    return {
      success: true,
      serviceName: service,
      imageTag: previousTag,
      previousTag: currentTag,
      rollbackTriggered: true,
    };
  }

  /**
   * Retain only the last `maxVersions` versions.
   * Remove oldest versions when count exceeds the limit.
   */
  async retainVersions(service: string, maxVersions: number = DEFAULT_MAX_VERSIONS_RETAINED): Promise<void> {
    const versions = await this.client.listVersions(service);

    if (versions.length <= maxVersions) {
      return;
    }

    // Remove versions beyond the retention limit (oldest first)
    const toRemove = versions.slice(maxVersions);
    for (const tag of toRemove) {
      await this.client.deleteVersion(service, tag);
    }
  }

  /**
   * Poll health endpoint until healthy or timeout.
   * Returns true if healthy within timeout, false otherwise.
   */
  async healthCheck(url: string, timeout: number = DEFAULT_HEALTH_CHECK_TIMEOUT): Promise<boolean> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const healthy = await this.client.getHealth(url);
      if (healthy) {
        return true;
      }

      // Wait before next poll, but don't exceed deadline
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await this.sleepFn(Math.min(HEALTH_POLL_INTERVAL, remaining));
    }

    return false;
  }
}
