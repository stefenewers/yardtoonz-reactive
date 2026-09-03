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

  it("defaults lineage and metadata for minimal artifact records", () => {
    expect(
      createArtifactRecord({ id: "a-1", jobId: "job-1", provider: "MOCK" }),
    ).toMatchObject({ parentArtifactIds: [], metadata: {} });
  });

  it("retains storage integrity, kind, and lineage fields", () => {
    const record = createArtifactRecord({
      id: "job-1-source",
      jobId: "job-1",
      kind: "SOURCE_VIDEO",
      storageKey: "job-1/source.mp4",
      mimeType: "video/mp4",
      byteSize: 1024,
      sha256: "a".repeat(64),
      parentArtifactIds: [],
      provider: "USER_UPLOAD",
      metadata: { durationSeconds: 6.3 },
      createdAt: "2026-09-03T00:00:00.000Z",
    });

    expect(record).toMatchObject({
      kind: "SOURCE_VIDEO",
      storageKey: "job-1/source.mp4",
      byteSize: 1024,
      sha256: "a".repeat(64),
      metadata: { durationSeconds: 6.3 },
    });
  });

  it("rejects malformed integrity data", () => {
    expect(() =>
      createArtifactRecord({
        id: "a-1",
        jobId: "job-1",
        provider: "USER_UPLOAD",
        sha256: "not-a-hash",
      }),
    ).toThrow();
    expect(() =>
      createArtifactRecord({
        id: "a-1",
        jobId: "job-1",
        provider: "USER_UPLOAD",
        byteSize: -1,
      }),
    ).toThrow();
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
