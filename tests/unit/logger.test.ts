import { describe, expect, it } from "vitest";

import {
  createLogger,
  type LoggerOptions,
  type StructuredLogContext,
} from "../../src/lib/logger";

function captureLines(minLevel?: LoggerOptions["minLevel"]) {
  const lines: string[] = [];
  const logger = createLogger({
    minLevel,
    write: (line) => lines.push(line),
  });

  return { lines, logger };
}

describe("createLogger", () => {
  it("emits single-line JSON with timestamp, level, and message", () => {
    const { lines, logger } = captureLines();

    logger.info("Worker started");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, string>;
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("Worker started");
    expect(entry.timestamp).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it("includes the specification's structured fields when provided", () => {
    const context: StructuredLogContext = {
      requestId: "req-1",
      productionId: "prod-1",
      stage: "STYLE_IMAGE",
      attempt: 2,
      provider: "MOCK",
      providerMode: "mock",
      elapsedMs: 421,
      errorCode: "MEDIA_TOOL_TIMED_OUT",
    };
    const { lines, logger } = captureLines();

    logger.warn("Stage attempt recorded", context);

    const entry = JSON.parse(lines[0]) as Record<string, string | number>;
    expect(entry.requestId).toBe("req-1");
    expect(entry.productionId).toBe("prod-1");
    expect(entry.stage).toBe("STYLE_IMAGE");
    expect(entry.attempt).toBe(2);
    expect(entry.provider).toBe("MOCK");
    expect(entry.providerMode).toBe("mock");
    expect(entry.elapsedMs).toBe(421);
    expect(entry.errorCode).toBe("MEDIA_TOOL_TIMED_OUT");
  });

  it("omits undefined fields instead of serializing them", () => {
    const { lines, logger } = captureLines();

    logger.info("Nothing optional", { productionId: undefined });

    expect(lines[0]).not.toContain("productionId");
  });

  it("merges child context with call-site overrides", () => {
    const { lines, logger } = captureLines();

    const child = logger.child({ workerId: "worker-1", stage: "MUXING" });
    child.info("Inherited only");
    child.info("Overridden", { stage: "VALIDATING" });

    const first = JSON.parse(lines[0]) as Record<string, string>;
    expect(first.workerId).toBe("worker-1");
    expect(first.stage).toBe("MUXING");

    const second = JSON.parse(lines[1]) as Record<string, string>;
    expect(second.stage).toBe("VALIDATING");
  });

  it("drops events below the minimum level", () => {
    const { lines, logger } = captureLines("info");

    logger.debug("Noisy detail");
    logger.info("Operational event");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, string>;
    expect(entry.level).toBe("info");
  });
});
