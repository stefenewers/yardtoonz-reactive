import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "../../src/lib/env-schema";

describe("parseServerEnvironment", () => {
  it("uses credential-free mock defaults", () => {
    expect(parseServerEnvironment({})).toMatchObject({
      PROVIDER_MODE: "MOCK",
      MAX_UPLOAD_MB: 100,
      WORKER_POLL_MS: 1000,
    });
  });

  it("rejects invalid positive integer settings", () => {
    expect(() => parseServerEnvironment({ MAX_UPLOAD_MB: "0" })).toThrow();
    expect(() => parseServerEnvironment({ WORKER_POLL_MS: "1.5" })).toThrow();
  });

  it("requires the complete future provider configuration in live mode", () => {
    expect(() => parseServerEnvironment({ PROVIDER_MODE: "LIVE" })).toThrow(
      /OPENAI_API_KEY is required/,
    );
  });
});
