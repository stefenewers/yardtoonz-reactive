import { describe, expect, it } from "vitest";

import {
  buildLineageChain,
  inspectArtifact,
  lineageExplorerUrl,
  lineageGraphState,
  lineageStateCopy,
  previewKindForMime,
  type LineageNode,
} from "../../src/domain/lineage-explorer";
import type { ProductionArtifactView } from "../../src/shared/productions";

const ISO = "2026-09-03T12:00:00.000Z";
const SHA = "a".repeat(64);

function makeArtifact(
  overrides: Partial<ProductionArtifactView> = {},
): ProductionArtifactView {
  return {
    id: "artifact-1",
    kind: "SOURCE_VIDEO",
    provider: "USER_UPLOAD",
    mimeType: "video/mp4",
    byteSize: 2048,
    sha256: SHA,
    metadata: {},
    createdAt: ISO,
    ...overrides,
  };
}

function stageLabels(artifacts: readonly ProductionArtifactView[]) {
  return buildLineageChain(artifacts).map((stage) => stage.label);
}

describe("previewKindForMime", () => {
  it.each([
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/mp4", "audio"],
    ["application/json", "none"],
  ] as const)("maps %s to %s", (mimeType, expected) => {
    expect(previewKindForMime(mimeType)).toBe(expected);
  });
});

describe("buildLineageChain", () => {
  it("orders a complete lineage from source to final output", () => {
    const artifacts = [
      makeArtifact({ id: "final", kind: "FINAL_VIDEO", provider: "FFMPEG" }),
      makeArtifact({ id: "keyframe", kind: "KEYFRAME", provider: "MOCK" }),
      makeArtifact({ id: "source", kind: "SOURCE_VIDEO" }),
      makeArtifact({
        id: "styled",
        kind: "STYLED_FRAME",
        provider: "OPENAI",
        providerRequestId: "req-77",
      }),
    ];

    expect(stageLabels(artifacts)).toEqual([
      "Source clip",
      "Keyframe",
      "Clay frame",
      "Final output",
    ]);
  });

  it("keeps extracted clip and audio as siblings of one extraction stage", () => {
    const artifacts = [
      makeArtifact({ id: "clip", kind: "EXTRACTED_CLIP", provider: "FFMPEG" }),
      makeArtifact({
        id: "audio",
        kind: "EXTRACTED_AUDIO",
        provider: "FFMPEG",
        mimeType: "audio/mp4",
      }),
    ];

    const stages = buildLineageChain(artifacts);
    expect(stages).toHaveLength(1);
    expect(stages[0].label).toBe("Extraction");
    expect(stages[0].nodes.map((node) => node.label)).toEqual([
      "Extraction (video)",
      "Extraction (audio)",
    ]);
  });

  it("marks the newest artifact of a kind as latest and retries as superseded", () => {
    const artifacts = [
      makeArtifact({
        id: "styled-attempt-1",
        kind: "STYLED_FRAME",
        createdAt: "2026-09-03T12:00:00.000Z",
      }),
      makeArtifact({
        id: "styled-attempt-2",
        kind: "STYLED_FRAME",
        createdAt: "2026-09-03T12:05:00.000Z",
      }),
    ];

    const [stage] = buildLineageChain(artifacts);
    expect(stage.nodes.map((node) => [node.id, node.state])).toEqual([
      ["styled-attempt-1", "superseded"],
      ["styled-attempt-2", "latest"],
    ]);
  });

  it("skips kinds with no artifacts instead of drawing placeholders", () => {
    const artifacts = [makeArtifact({ id: "source" })];

    const stages = buildLineageChain(artifacts);
    expect(stages).toHaveLength(1);
    expect(stages[0].nodes).toHaveLength(1);
    expect(stages[0].nodes[0].previewKind).toBe("video");
  });

  it("carries provider, size, checksum, and request id onto each node", () => {
    const artifacts = [
      makeArtifact({
        id: "styled",
        kind: "STYLED_FRAME",
        provider: "OPENAI",
        providerRequestId: "req-77",
        byteSize: 4096,
      }),
    ];

    const node = buildLineageChain(artifacts)[0].nodes[0];
    expect(node.providerLabel).toBe("OpenAI");
    expect(node.providerRequestId).toBe("req-77");
    expect(node.sizeLabel).toBe("4.0 KB");
    expect(node.sha256).toBe(SHA);
    expect(node.state).toBe("latest");
  });

  it("keeps unknown kinds inspectable rather than dropping them", () => {
    const artifacts = [
      makeArtifact({
        id: "mystery",
        kind: "UNSUPPORTED_KIND" as ProductionArtifactView["kind"],
        mimeType: "application/json",
      }),
    ];

    const stages = buildLineageChain(artifacts);
    expect(stages).toHaveLength(1);
    expect(stages[0].nodes[0].label).toBe("UNSUPPORTED_KIND");
  });
});

describe("lineageGraphState", () => {
  it("is empty when no artifacts exist, whatever the status", () => {
    expect(lineageGraphState("COMPLETE", [])).toBe("empty");
    expect(lineageGraphState("FAILED", [])).toBe("empty");
  });

  it("is failed for a failed production with stored artifacts", () => {
    expect(lineageGraphState("FAILED", [makeArtifact()])).toBe("failed");
  });

  it("is complete only for a complete production with artifacts", () => {
    expect(lineageGraphState("COMPLETE", [makeArtifact()])).toBe("complete");
  });

  it("is sparse while the job is queued or running", () => {
    expect(lineageGraphState("QUEUED", [makeArtifact()])).toBe("sparse");
    expect(lineageGraphState("STYLING", [makeArtifact()])).toBe("sparse");
  });

  it("gives every state human-readable copy", () => {
    for (const state of ["empty", "sparse", "complete", "failed"] as const) {
      expect(lineageStateCopy[state].heading.length).toBeGreaterThan(0);
      expect(lineageStateCopy[state].detail.length).toBeGreaterThan(0);
    }
  });
});

describe("inspectArtifact", () => {
  const baseNode: LineageNode = {
    id: "styled",
    kind: "STYLED_FRAME",
    label: "Clay frame",
    providerLabel: "OpenAI",
    providerRequestId: "req-77",
    mimeType: "image/png",
    previewKind: "image",
    byteSize: 4096,
    sizeLabel: "4.0 KB",
    createdAt: ISO,
    clockLabel: "12:00:00",
    sha256: SHA,
    state: "latest",
  };

  it("lists identity, attribution, integrity, and state in order", () => {
    const fields = inspectArtifact(baseNode, {});
    expect(fields.map((field) => field.label)).toEqual([
      "Kind",
      "Provider",
      "Provider request ID",
      "Media type",
      "Size",
      "Created",
      "SHA-256",
      "State",
    ]);
    expect(fields.find((field) => field.label === "SHA-256")?.value).toBe(SHA);
    expect(fields.find((field) => field.label === "State")?.value).toBe(
      "Latest of its kind",
    );
  });

  it("marks checksums and request ids as mono values", () => {
    const fields = inspectArtifact(baseNode, {});
    expect(fields.find((field) => field.label === "SHA-256")?.mono).toBe(true);
    expect(
      fields.find((field) => field.label === "Provider request ID")?.mono,
    ).toBe(true);
    expect(
      fields.find((field) => field.label === "Kind")?.mono,
    ).toBeUndefined();
  });

  it("reports a superseded state honestly", () => {
    const fields = inspectArtifact({ ...baseNode, state: "superseded" }, {});
    expect(fields.find((field) => field.label === "State")?.value).toBe(
      "Superseded by a retry",
    );
  });

  it("appends humanized metadata rows and skips empty values", () => {
    const fields = inspectArtifact(baseNode, {
      width: 1080,
      height: 1920,
      audioPresent: true,
      sourceName: "",
      note: null,
      customKey: "v2",
    });

    const labels = fields.map((field) => field.label);
    expect(labels).toContain("Width");
    expect(labels).toContain("Height");
    expect(labels).toContain("Audio present");
    expect(labels).toContain("customKey");
    expect(labels).not.toContain("sourceName");
    expect(labels).not.toContain("note");
    expect(fields.find((field) => field.label === "Width")?.value).toBe("1080");
  });

  it("omits the request id row when the artifact has none", () => {
    const fields = inspectArtifact(
      { ...baseNode, providerRequestId: undefined },
      {},
    );
    expect(fields.map((field) => field.label)).not.toContain(
      "Provider request ID",
    );
  });
});

describe("lineageExplorerUrl", () => {
  it("deep-links a production with a selected artifact", () => {
    expect(lineageExplorerUrl("prod-1", "art-9")).toBe(
      "/lineage?production=prod-1&artifact=art-9",
    );
  });

  it("links the whole explorer when no artifact is named", () => {
    expect(lineageExplorerUrl("prod-1")).toBe("/lineage?production=prod-1");
  });

  it("encodes identifiers into the query string", () => {
    expect(lineageExplorerUrl("prod id", "art&id")).toBe(
      "/lineage?production=prod%20id&artifact=art%26id",
    );
  });
});
