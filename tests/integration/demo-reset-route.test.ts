import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/db/reset", () => ({
  resetDemoData: vi.fn(),
}));

import { POST } from "../../src/app/api/demo/reset/route";
import { resetDemoData } from "../../src/server/db/reset";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/demo/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/demo/reset guards", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(resetDemoData).mockReset();
  });

  it("refuses without the explicit confirmation body", async () => {
    const response = await POST(makeRequest({ confirmation: false }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESET_CONFIRMATION_REQUIRED");
    expect(resetDemoData).not.toHaveBeenCalled();
  });

  it("refuses outside local demo mode", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(makeRequest({ confirmation: true }));

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error.code).toBe("DEMO_RESET_DISABLED");
    expect(resetDemoData).not.toHaveBeenCalled();
  });

  it("refuses when a live image provider is configured", async () => {
    vi.stubEnv("IMAGE_PROVIDER", "OPENAI");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_IMAGE_MODEL", "gpt-image-1");
    vi.stubEnv("OPENAI_DIRECTOR_MODEL", "gpt-5");

    const response = await POST(makeRequest({ confirmation: true }));

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error.code).toBe("DEMO_RESET_PROVIDER_GUARD");
    expect(resetDemoData).not.toHaveBeenCalled();
  });

  it("resets the demo data and reports the seeded candidate count", async () => {
    vi.mocked(resetDemoData).mockResolvedValue({
      databaseFile: "file:./.data/yardtoonz.db",
      artifactRoot: "/tmp/demo-artifacts",
      seededCandidates: 10,
    });

    const response = await POST(makeRequest({ confirmation: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reset: { seededCandidates: 10 },
    });
    expect(resetDemoData).toHaveBeenCalledTimes(1);
  });
});
