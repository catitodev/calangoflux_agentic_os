/**
 * Structured JSON logger for OpenClaw.
 *
 * Outputs valid JSON with required fields:
 * - timestamp: ISO 8601 format
 * - agent_id: identifier of the agent emitting the log
 * - level: "info" | "warn" | "error"
 * - message: human-readable log message
 * - metadata: optional additional context
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  agent_id: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LoggerOptions {
  agentId: string;
  /** Override output function for testing. Defaults to process.stdout.write */
  output?: (line: string) => void;
}

export class Logger {
  private readonly agentId: string;
  private readonly output: (line: string) => void;

  constructor(options: LoggerOptions) {
    this.agentId = options.agentId;
    this.output =
      options.output ?? ((line: string) => process.stdout.write(line + "\n"));
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log("error", message, metadata);
  }

  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      agent_id: this.agentId,
      level,
      message,
    };

    if (metadata !== undefined) {
      entry.metadata = metadata;
    }

    this.output(JSON.stringify(entry));
  }
}
