// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { JobOutput } from "../../src/components/job-output";
import { LineageExplorer } from "../../src/components/lineage-explorer";
import type { ProductionDetailResponse } from "../../src/shared/productions";

const ISO = "2026-09-03T12:00:00.000Z";
const SHA = "b".repeat(64);
const PROD_ID = "prod-lineage-1";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/agent-trace")) {
      return Promise.resolve(jsonResponse(200, { runs: [] }));
    }
    return handler(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeArtifact(
  overrides: Partial<ProductionDetailResponse["artifacts"][number]> = {},
): ProductionDetailResponse["artifacts"][number] {
  return {
    id: "artifact-source",
    kind: "SOURCE_VIDEO",
    provider: "USER_UPLOAD",
    mimeType: "video/mp4",
    byteSize: 4096,
    sha256: SHA,
    metadata: {},
    createdAt: ISO,
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<ProductionDetailResponse> = {},
): ProductionDetailResponse {
  return {
    production: {
      id: PROD_ID,
      candidateId: "cand-lineage-1",
      status: "COMPLETE",
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
      attempt: 1,
      createdAt: ISO,
      updatedAt: ISO,
    },
    stages: [],
    artifacts: [],
    ...overrides,
  };
}

const COMPLETE_ARTIFACTS: ProductionDetailResponse["artifacts"] = [
  makeArtifact({ id: "artifact-source" }),
  makeArtifact({
    id: "artifact-keyframe",
    kind: "KEYFRAME",
    provider: "MOCK",
    mimeType: "image/png",
    metadata: { width: 1080, height: 1920 },
  }),
  makeArtifact({
    id: "artifact-final",
    kind: "FINAL_VIDEO",
    provider: "FFMPEG",
    metadata: { durationSeconds: 6.2, audioPresent: true },
  }),
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LineageExplorer graph states", () => {
  it("renders a complete lineage as an interactive chain with the state banner", async () => {
    installFetch(async () =>
      jsonResponse(200, makeDetail({ artifacts: COMPLETE_ARTIFACTS })),
    );
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() =>
      expect(screen.getByText("Complete lineage")).toBeTruthy(),
    );
    for (const label of ["Source clip", "Keyframe", "Final output"]) {
      expect(screen.getByRole("heading", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("heading", { name: "Clay frame" })).toBeNull();
  });

  it("renders a failed production with a failed banner and inspectable artifacts", async () => {
    installFetch(async () =>
      jsonResponse(
        200,
        makeDetail({
          production: {
            id: PROD_ID,
            candidateId: "cand-lineage-1",
            status: "FAILED",
            imageProvider: "MOCK",
            animationProvider: "MOCK",
            segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
            attempt: 1,
            createdAt: ISO,
            updatedAt: ISO,
          },
          artifacts: [makeArtifact({ id: "artifact-source" })],
        }),
      ),
    );
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() =>
      expect(screen.getByText("Failed lineage")).toBeTruthy(),
    );
    // "Source clip" names both the stage heading and its single node.
    expect(screen.getByRole("heading", { name: "Source clip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Source clip/ })).toBeTruthy();
  });

  it("renders a sparse in-progress lineage from a running production", async () => {
    installFetch(async () =>
      jsonResponse(
        200,
        makeDetail({
          production: {
            id: PROD_ID,
            candidateId: "cand-lineage-1",
            status: "STYLING",
            imageProvider: "OPENAI",
            animationProvider: "MOCK",
            segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
            attempt: 1,
            createdAt: ISO,
            updatedAt: ISO,
          },
          artifacts: [makeArtifact({ id: "artifact-source" })],
        }),
      ),
    );
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() =>
      expect(screen.getByText("Lineage in progress")).toBeTruthy(),
    );
  });

  it("shows the empty state when nothing is stored yet", async () => {
    installFetch(async () => jsonResponse(200, makeDetail({ artifacts: [] })));
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() =>
      expect(screen.getByText("No artifacts yet")).toBeTruthy(),
    );
    expect(screen.getByText(/No artifacts have been stored/)).toBeTruthy();
  });

  it("marks superseded retries and keeps them drillable", async () => {
    installFetch(async () =>
      jsonResponse(
        200,
        makeDetail({
          artifacts: [
            makeArtifact({
              id: "styled-1",
              kind: "STYLED_FRAME",
              provider: "OPENAI",
              mimeType: "image/png",
              createdAt: "2026-09-03T12:00:00.000Z",
            }),
            makeArtifact({
              id: "styled-2",
              kind: "STYLED_FRAME",
              provider: "OPENAI",
              mimeType: "image/png",
              createdAt: "2026-09-03T12:05:00.000Z",
            }),
          ],
        }),
      ),
    );
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() =>
      expect(screen.getAllByText("Superseded")).toHaveLength(1),
    );
  });
});

describe("LineageExplorer inspector drill-in", () => {
  it("opens the inspector with checksum, provider attribution, and preview on click", async () => {
    installFetch(async () =>
      jsonResponse(200, makeDetail({ artifacts: COMPLETE_ARTIFACTS })),
    );
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() => screen.getByText("Complete lineage"));
    fireEvent.click(screen.getByRole("button", { name: /Keyframe/ }));

    await waitFor(() =>
      expect(
        screen.getByLabelText(/Artifact inspector: Keyframe/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(SHA)).toBeTruthy();
    expect(screen.getByText("1080")).toBeTruthy();
    const preview = screen.getByAltText("Keyframe preview");
    expect(preview.getAttribute("src")).toBe(
      `/api/productions/${PROD_ID}/artifacts/artifact-keyframe`,
    );
  });

  it("rewrites the URL when a node is selected so the view stays shareable", async () => {
    installFetch(async () =>
      jsonResponse(200, makeDetail({ artifacts: COMPLETE_ARTIFACTS })),
    );
    const replaceState = vi.fn();
    Object.defineProperty(window, "history", {
      value: { replaceState },
      configurable: true,
    });

    render(<LineageExplorer productionId={PROD_ID} />);
    await waitFor(() => screen.getByText("Complete lineage"));
    fireEvent.click(screen.getByRole("button", { name: /Final output/ }));

    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(
        null,
        "",
        `/lineage?production=${PROD_ID}&artifact=artifact-final`,
      ),
    );
  });

  it("hides media preview rows for audio artifacts while offering playback", async () => {
    installFetch(async () =>
      jsonResponse(
        200,
        makeDetail({
          artifacts: [
            makeArtifact({
              id: "artifact-audio",
              kind: "EXTRACTED_AUDIO",
              mimeType: "audio/mp4",
            }),
          ],
        }),
      ),
    );
    render(<LineageExplorer productionId={PROD_ID} />);

    await waitFor(() =>
      screen.getByRole("button", { name: /Extraction \(audio\)/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Extraction \(audio\)/ }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Extraction (audio) preview")).toBeTruthy(),
    );
  });
});

describe("LineageExplorer deep links", () => {
  it("selects the deep-linked artifact as soon as the detail arrives", async () => {
    installFetch(async () =>
      jsonResponse(200, makeDetail({ artifacts: COMPLETE_ARTIFACTS })),
    );
    render(
      <LineageExplorer
        productionId={PROD_ID}
        initialArtifactId="artifact-keyframe"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText(/Artifact inspector: Keyframe/),
      ).toBeTruthy(),
    );
    expect(screen.getByText("1080")).toBeTruthy();
  });

  it("reports a stale deep link instead of a silent no-selection", async () => {
    installFetch(async () =>
      jsonResponse(200, makeDetail({ artifacts: COMPLETE_ARTIFACTS })),
    );
    render(
      <LineageExplorer
        productionId={PROD_ID}
        initialArtifactId="artifact-deleted"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/The linked artifact is gone/)).toBeTruthy(),
    );
  });

  it("exposes deep links from the job monitor's artifact lineage", async () => {
    installFetch(async () =>
      jsonResponse(200, makeDetail({ artifacts: COMPLETE_ARTIFACTS })),
    );
    render(<JobOutput productionId={PROD_ID} />);

    const explorerLink = await waitFor(() =>
      screen.getByTestId("lineage-explorer-link"),
    );
    expect(explorerLink.getAttribute("href")).toBe(
      `/lineage?production=${PROD_ID}`,
    );

    const detailsLinks = screen
      .getAllByRole("link", { name: "Details" })
      .map((link) => link.getAttribute("href"));
    expect(detailsLinks).toEqual([
      `/lineage?production=${PROD_ID}&artifact=artifact-source`,
      `/lineage?production=${PROD_ID}&artifact=artifact-keyframe`,
      `/lineage?production=${PROD_ID}&artifact=artifact-final`,
    ]);
  });
});
