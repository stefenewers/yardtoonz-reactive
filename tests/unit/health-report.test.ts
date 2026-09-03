import { describe, expect, it } from "vitest";

import { createPublicHealthReport } from "../../src/lib/health-report";
import type { MediaToolStatus } from "../../src/lib/media-tools";

const privateFailure: MediaToolStatus = {
  name: "ffmpeg",
  available: false,
  diagnostic: "execution-failed",
  path: "/private/server/node_modules/ffmpeg-static/ffmpeg",
  error: "spawn failed with secret raw detail",
};

describe("createPublicHealthReport", () => {
  it("publishes provider selections and safe diagnostic categories", () => {
    expect(
      createPublicHealthReport(
        { IMAGE_PROVIDER: "OPENAI", ANIMATION_PROVIDER: "MOCK" },
        [privateFailure],
      ),
    ).toEqual({
      status: "degraded",
      providers: { image: "OPENAI", animation: "MOCK" },
      checks: {
        mediaTools: [
          {
            name: "ffmpeg",
            available: false,
            diagnostic: "execution-failed",
          },
        ],
      },
    });
  });

  it("never serializes filesystem paths or raw error strings", () => {
    const serialized = JSON.stringify(
      createPublicHealthReport(
        { IMAGE_PROVIDER: "MOCK", ANIMATION_PROVIDER: "MOCK" },
        [
          privateFailure,
          {
            name: "ffprobe",
            available: true,
            diagnostic: "available",
            path: "/private/server/ffprobe",
            version: "raw version output",
          },
        ],
      ),
    );

    expect(serialized).not.toContain("/private/server");
    expect(serialized).not.toContain("secret raw detail");
    expect(serialized).not.toContain("raw version output");
    expect(serialized).not.toContain('"path"');
    expect(serialized).not.toContain('"error"');
    expect(serialized).not.toContain('"version"');
  });
});
