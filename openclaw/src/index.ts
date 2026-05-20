/**
 * OpenClaw — CalangoFlux Agentic OS External Action Executor
 *
 * Entry point: initializes logger, creates pipeline, starts HTTP health server,
 * and connects to Redis Streams for message consumption.
 */

import { createServer } from 'node:http';
import { createPipeline, loadConfig } from './pipeline.js';
import { Logger } from './logger.js';

const logger = new Logger({ agentId: 'openclaw' });
const config = loadConfig();

logger.info('OpenClaw starting', {
  port: config.port,
  redisUrl: config.redisUrl,
  stream: config.streamKey,
  geminiStream: config.geminiStreamKey,
  consumerGroup: config.consumerGroup,
});

// Create pipeline
const pipeline = createPipeline(config);

// HTTP health endpoint
const server = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'openclaw', timestamp: new Date().toISOString() }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Start
async function main(): Promise<void> {
  try {
    // Start HTTP server
    server.listen(config.port, () => {
      logger.info('Health server listening', { port: config.port });
    });

    // Connect to Redis and start consuming
    await pipeline.start();
    logger.info('Pipeline started successfully');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to start OpenClaw', { error: message });
    process.exit(1);
  }
}

// Graceful shutdown
function shutdown(): void {
  logger.info('Shutting down...');
  server.close();
  pipeline.stop().then(() => {
    logger.info('Shutdown complete');
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main();
