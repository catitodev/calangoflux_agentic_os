import { describe, it, expect } from "vitest";
import { Logger, LogEntry, LogLevel } from "./logger.js";

function createTestLogger(agentId = "test-agent") {
  const lines: string[] = [];
  const logger = new Logger({
    agentId,
    output: (line: string) => {
      lines.push(line);
    },
  });
  return { logger, lines };
}

function parseEntry(line: string): LogEntry {
  return JSON.parse(line) as LogEntry;
}

describe("Logger", () => {
  describe("JSON output format", () => {
    it("should output valid JSON for info level", () => {
      const { logger, lines } = createTestLogger();
      logger.info("hello world");

      expect(lines).toHaveLength(1);
      const entry = parseEntry(lines[0]);
      expect(entry).toBeDefined();
    });

    it("should output valid JSON for warn level", () => {
      const { logger, lines } = createTestLogger();
      logger.warn("something concerning");

      const entry = parseEntry(lines[0]);
      expect(entry.level).toBe("warn");
    });

    it("should output valid JSON for error level", () => {
      const { logger, lines } = createTestLogger();
      logger.error("something broke");

      const entry = parseEntry(lines[0]);
      expect(entry.level).toBe("error");
    });
  });

  describe("required fields", () => {
    it("should include timestamp in ISO 8601 format", () => {
      const { logger, lines } = createTestLogger();
      logger.info("test");

      const entry = parseEntry(lines[0]);
      expect(entry.timestamp).toBeDefined();
      // ISO 8601 format check: parseable and produces valid date
      const date = new Date(entry.timestamp);
      expect(date.toISOString()).toBe(entry.timestamp);
    });

    it("should include agent_id matching the configured value", () => {
      const { logger, lines } = createTestLogger("openclaw-worker-1");
      logger.info("test");

      const entry = parseEntry(lines[0]);
      expect(entry.agent_id).toBe("openclaw-worker-1");
    });

    it("should include level field with correct value", () => {
      const { logger, lines } = createTestLogger();

      logger.info("a");
      logger.warn("b");
      logger.error("c");

      const levels = lines.map((l) => parseEntry(l).level);
      expect(levels).toEqual(["info", "warn", "error"]);
    });

    it("should include message field with the provided text", () => {
      const { logger, lines } = createTestLogger();
      logger.info("action executed successfully");

      const entry = parseEntry(lines[0]);
      expect(entry.message).toBe("action executed successfully");
    });
  });

  describe("metadata", () => {
    it("should include metadata when provided", () => {
      const { logger, lines } = createTestLogger();
      logger.info("request processed", { requestId: "req-123", duration: 42 });

      const entry = parseEntry(lines[0]);
      expect(entry.metadata).toEqual({ requestId: "req-123", duration: 42 });
    });

    it("should omit metadata field when not provided", () => {
      const { logger, lines } = createTestLogger();
      logger.info("simple message");

      const entry = parseEntry(lines[0]);
      expect(entry).not.toHaveProperty("metadata");
    });

    it("should handle empty metadata object", () => {
      const { logger, lines } = createTestLogger();
      logger.info("with empty meta", {});

      const entry = parseEntry(lines[0]);
      expect(entry.metadata).toEqual({});
    });

    it("should handle nested metadata", () => {
      const { logger, lines } = createTestLogger();
      logger.warn("complex event", {
        tool: "web_search",
        params: { query: "test", limit: 10 },
      });

      const entry = parseEntry(lines[0]);
      expect(entry.metadata).toEqual({
        tool: "web_search",
        params: { query: "test", limit: 10 },
      });
    });
  });

  describe("multiple log entries", () => {
    it("should produce one JSON line per log call", () => {
      const { logger, lines } = createTestLogger();
      logger.info("first");
      logger.warn("second");
      logger.error("third");

      expect(lines).toHaveLength(3);
      // Each line should be independently parseable
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  describe("level validation", () => {
    it("should only produce info, warn, or error levels", () => {
      const { logger, lines } = createTestLogger();
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      const validLevels: LogLevel[] = ["info", "warn", "error"];
      for (const line of lines) {
        const entry = parseEntry(line);
        expect(validLevels).toContain(entry.level);
      }
    });
  });
});
