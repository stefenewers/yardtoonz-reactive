import { describe, expect, it } from "vitest";

import {
  createArtifactRecord,
  createProductionJobRecord,
} from "../../src/lib/production-records";

describe("production record contracts", () => {
  it.each([
    ["MOCK", "MOCK"],
    ["OPENAI", "MOCK"],
    ["MOCK", "RUNWAY"],
    ["OPENAI", "RUNWAY"],
  ] as const)(
    "stores image provider %s and animation provider %s independently",
    (imageProvider, animationProvider) => {
      expect(
        createProductionJobRecord({
          id: "job-1",
          imageProvider,
          animationProvider,
        }),
      ).toEqual({ id: "job-1", imageProvider, animationProvider });
    },
  );

  it.each(["USER_UPLOAD", "FFMPEG", "MOCK", "OPENAI", "RUNWAY"] as const)(
    "stores %s as the artifact's actual producer",
    (provider) => {
      expect(
        createArtifactRecord({ id: "artifact-1", jobId: "job-1", provider }),
      ).toMatchObject({ provider });
    },
  );

  it("retains an optional live-provider request identifier", () => {
    expect(
      createArtifactRecord({
        id: "artifact-1",
        jobId: "job-1",
        provider: "RUNWAY",
        providerRequestId: "runway-request-1",
      }),
    ).toMatchObject({ providerRequestId: "runway-request-1" });
  });

  it("rejects an unrecognized producing provider", () => {
    expect(() =>
      createArtifactRecord({
        id: "artifact-1",
        jobId: "job-1",
        provider: "UNATTRIBUTED",
      }),
    ).toThrow();
  });
});
