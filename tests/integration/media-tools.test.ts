import { describe, expect, it } from "vitest";

import { getMediaToolHealth } from "../../src/lib/media-tools";

describe("package-managed media tools", () => {
  it("executes FFmpeg and FFprobe without host installations", async () => {
    const statuses = await getMediaToolHealth();

    expect(statuses).toHaveLength(2);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ffmpeg",
          available: true,
          diagnostic: "available",
        }),
        expect.objectContaining({
          name: "ffprobe",
          available: true,
          diagnostic: "available",
        }),
      ]),
    );
    for (const status of statuses)
      expect(status.version).toMatch(/ff(?:mpeg|probe) version/i);
  });
});
