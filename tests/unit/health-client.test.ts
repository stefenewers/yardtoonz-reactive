import { describe, expect, it } from "vitest";

import { fetchHealthReport } from "../../src/lib/health-client";

const healthyReport = {
  status: "ok",
  providers: { image: "MOCK", animation: "MOCK" },
  checks: {
    database: { diagnostic: "available" },
    artifactRoot: { diagnostic: "writable" },
    mediaTools: [
      { name: "ffmpeg", available: true, diagnostic: "available" },
      { name: "ffprobe", available: true, diagnostic: "available" },
    ],
    worker: { diagnostic: "unknown" },
  },
};

function respondWith(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchHealthReport", () => {
  it("parses the public health payload on success", async () => {
    const report = await fetchHealthReport(() =>
      Promise.resolve(respondWith(healthyReport)),
    );

    expect(report.status).toBe("ok");
    expect(report.providers).toEqual({ image: "MOCK", animation: "MOCK" });
    expect(report.checks.mediaTools).toHaveLength(2);
  });

  it("parses a degraded payload delivered with a 503 response", async () => {
    const report = await fetchHealthReport(() =>
      Promise.resolve(
        respondWith(
          {
            ...healthyReport,
            status: "degraded",
            checks: {
              ...healthyReport.checks,
              database: { diagnostic: "unavailable" },
            },
          },
          false,
        ),
      ),
    );

    expect(report.status).toBe("degraded");
    expect(report.checks.database.diagnostic).toBe("unavailable");
  });

  it("rejects a malformed body instead of trusting it", async () => {
    await expect(
      fetchHealthReport(() =>
        Promise.resolve(respondWith({ status: "ok", providers: "garbage" })),
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects when the network request itself fails", async () => {
    await expect(
      fetchHealthReport(() => Promise.reject(new Error("offline"))),
    ).rejects.toBeInstanceOf(Error);
  });
});
