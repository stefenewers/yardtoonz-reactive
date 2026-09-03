import { describe, expect, it } from "vitest";

import {
  classifyWorkerHeartbeat,
  createPublicHealthReport,
  deriveWorkerHeartbeatStaleAfterMs,
  type HealthCheckResults,
} from "../../src/lib/health-report";
import type { MediaToolStatus } from "../../src/lib/media-tools";

const environment = {
  IMAGE_PROVIDER: "MOCK",
  ANIMATION_PROVIDER: "MOCK",
} as const;

const privateFailure: MediaToolStatus = {
  name: "ffmpeg",
  available: false,
  diagnostic: "execution-failed",
  path: "/private/server/node_modules/ffmpeg-static/ffmpeg",
  error: "spawn failed with secret raw detail",
};

const availableTool: MediaToolStatus = {
  name: "ffprobe",
  available: true,
  diagnostic: "available",
  path: "/private/server/ffprobe",
  version: "raw version output",
};

describe("createPublicHealthReport", () => {
  it("publishes provider selections and safe diagnostic categories", () => {
    expect(
      createPublicHealthReport(
        { IMAGE_PROVIDER: "OPENAI", ANIMATION_PROVIDER: "MOCK" },
        {
          database: "available",
          artifactRoot: "writable",
          mediaTools: [privateFailure],
          worker: "fresh",
        },
      ),
    ).toEqual({
      status: "degraded",
      providers: { image: "OPENAI", animation: "MOCK" },
      checks: {
        database: { diagnostic: "available" },
        artifactRoot: { diagnostic: "writable" },
        mediaTools: [
          {
            name: "ffmpeg",
            available: false,
            diagnostic: "execution-failed",
          },
        ],
        worker: { diagnostic: "fresh" },
      },
    });
  });

  it("keeps the aggregate ok when the worker has never reported", () => {
    expect(
      createPublicHealthReport(environment, {
        database: "available",
        artifactRoot: "writable",
        mediaTools: [availableTool],
        worker: "unknown",
      }).status,
    ).toBe("ok");
  });

  it("keeps the aggregate ok when a heartbeat is stale", () => {
    expect(
      createPublicHealthReport(environment, {
        database: "available",
        artifactRoot: "writable",
        mediaTools: [availableTool],
        worker: "stale",
      }).status,
    ).toBe("ok");
  });

  it("degrades when the database, artifact root, or a media tool fails", () => {
    const healthy: HealthCheckResults = {
      artifactRoot: "writable",
      mediaTools: [availableTool],
      worker: "unknown",
      database: "available",
    };

    const failingChecks: HealthCheckResults[] = [
      { ...healthy, database: "unavailable" },
      { ...healthy, artifactRoot: "unwritable" },
      { ...healthy, mediaTools: [privateFailure] },
    ];

    const statuses = failingChecks.map(
      (checks) => createPublicHealthReport(environment, checks).status,
    );

    expect(statuses).toEqual(["degraded", "degraded", "degraded"]);
  });

  it("never serializes filesystem paths or raw error strings", () => {
    const serialized = JSON.stringify(
      createPublicHealthReport(environment, {
        database: "unavailable",
        artifactRoot: "unwritable",
        mediaTools: [privateFailure, availableTool],
        worker: "stale",
      }),
    );

    expect(serialized).not.toContain("/private/server");
    expect(serialized).not.toContain("secret raw detail");
    expect(serialized).not.toContain("raw version output");
    expect(serialized).not.toContain('"path"');
    expect(serialized).not.toContain('"error"');
    expect(serialized).not.toContain('"version"');
    expect(serialized).not.toContain('"observedAt"');
  });
});

describe("classifyWorkerHeartbeat", () => {
  const staleAfterMs = 30_000;

  it("reports unknown when no heartbeat exists", () => {
    expect(classifyWorkerHeartbeat(undefined, 1_000, staleAfterMs)).toBe(
      "unknown",
    );
  });

  it("reports fresh within the window including the boundary", () => {
    expect(classifyWorkerHeartbeat(0, staleAfterMs, staleAfterMs)).toBe(
      "fresh",
    );
  });

  it("reports stale past the window", () => {
    expect(classifyWorkerHeartbeat(0, staleAfterMs + 1, staleAfterMs)).toBe(
      "stale",
    );
  });
});

describe("deriveWorkerHeartbeatStaleAfterMs", () => {
  it("uses the floor for short poll intervals", () => {
    expect(deriveWorkerHeartbeatStaleAfterMs(1_000)).toBe(30_000);
  });

  it("scales with long poll intervals", () => {
    expect(deriveWorkerHeartbeatStaleAfterMs(60_000)).toBe(1_800_000);
  });
});
