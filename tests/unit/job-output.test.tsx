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

const ISO = "2026-09-03T12:00:00.000Z";
const SHA = "a".repeat(64);
const STAGE_NAMES = [
  "INGEST_SOURCE",
  "EXTRACT_MEDIA",
  "SELECT_KEYFRAME",
  "STYLE_IMAGE",
  "ANIMATE_IMAGE",
  "MUX_AND_NORMALIZE",
  "VALIDATE_OUTPUT",
] as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
) {
  // The embedded agent-trace monitor polls its own API; route those calls
  // to an empty trace so job assertions stay focused on the monitor.
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/agent-trace")) {
      return Promise.resolve(jsonResponse(200, { runs: [] }));
    }
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function findCall(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
  method: string,
) {
  return fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === url &&
      ((init?.method as string | undefined) ?? "GET").toUpperCase() === method,
  );
}

function makeStage(overrides: Record<string, unknown> = {}) {
  return {
    id: `stage-${overrides.name ?? "X"}`,
    name: "EXTRACT_MEDIA",
    status: "WAITING",
    attempt: 1,
    ...overrides,
  };
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
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

function makeDetail(overrides: Record<string, unknown> = {}) {
  const { detail, ...productionOverrides } = overrides;
  return {
    production: {
      id: "prod-e52",
      candidateId: "cand-e52",
      status: "QUEUED",
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      segment: { startSeconds: 0, endSeconds: 6, durationSeconds: 6 },
      attempt: 1,
      createdAt: ISO,
      updatedAt: ISO,
      ...productionOverrides,
    },
    stages: [],
    artifacts: [],
    ...(detail as Record<string, unknown> | undefined),
  };
}

const COMPLETE_FINAL_ARTIFACT = makeArtifact({
  id: "prod-e52-final",
  kind: "FINAL_VIDEO",
  provider: "FFMPEG",
  metadata: {
    durationSeconds: 6.2,
    width: 1080,
    height: 1920,
    videoCodec: "avc1",
    audioPresent: true,
  },
});

function completeDetail(overrides: Record<string, unknown> = {}) {
  const { detail, ...rest } = overrides;
  return makeDetail({
    status: "COMPLETE",
    ...rest,
    detail: {
      stages: STAGE_NAMES.map((name) =>
        makeStage({ id: `stage-${name}`, name, status: "COMPLETE" }),
      ),
      artifacts: [
        makeArtifact({ id: "prod-e52-source" }),
        COMPLETE_FINAL_ARTIFACT,
      ],
      ...(detail as Record<string, unknown> | undefined),
    },
  });
}

function renderMonitor(onBack = vi.fn()) {
  render(<JobOutput productionId="prod-e52" onBack={onBack} />);
  return onBack;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JobOutput", () => {
  it("renders the seven-stage timeline with complete, running, and waiting states", async () => {
    installFetch(async () =>
      jsonResponse(
        200,
        makeDetail({
          status: "EXTRACTING",
          activeStage: "EXTRACT_MEDIA",
          detail: {
            stages: [
              makeStage({
                id: "stage-ingest",
                name: "INGEST_SOURCE",
                status: "COMPLETE",
                completedAt: ISO,
              }),
              makeStage({
                id: "stage-extract",
                name: "EXTRACT_MEDIA",
                status: "RUNNING",
                startedAt: new Date(Date.now() - 2_000).toISOString(),
              }),
            ],
          },
        }),
      ),
    );
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    const timeline = screen.getByLabelText("Production stage timeline");
    expect(timeline.children).toHaveLength(7);

    const ingestRow = screen.getByText("Ingest source").closest("li");
    expect(ingestRow?.textContent).toContain("Complete at");

    const extractRow = screen.getByText("Extract clip and audio").closest("li");
    expect(extractRow?.getAttribute("aria-current")).toBe("step");
    expect(extractRow?.textContent).toMatch(/Running ·/);

    const waitingRow = screen.getByText("Validate output").closest("li");
    expect(waitingRow?.getAttribute("aria-current")).toBeNull();
    expect(waitingRow?.textContent).toContain("Waiting");
  });

  it("announces a still-working stage past the slow threshold instead of failing it", async () => {
    installFetch(async () =>
      jsonResponse(
        200,
        makeDetail({
          status: "ANIMATING",
          activeStage: "ANIMATE_IMAGE",
          detail: {
            stages: [
              makeStage({
                id: "stage-animate",
                name: "ANIMATE_IMAGE",
                status: "RUNNING",
                startedAt: new Date(Date.now() - 30_000).toISOString(),
              }),
            ],
          },
        }),
      ),
    );
    renderMonitor();

    await screen.findByText(
      "Still working — this stage is taking longer than usual, but the job has not failed.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the safe failure banner and retry re-arms the production", async () => {
    const fetchMock = installFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (
        url === "/api/productions/prod-e52" &&
        method.toUpperCase() === "GET"
      ) {
        return jsonResponse(200, failedDetail());
      }
      if (
        url === "/api/productions/prod-e52/retry" &&
        method.toUpperCase() === "POST"
      ) {
        return jsonResponse(200, makeDetail({ status: "QUEUED" }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "The animation stage failed after repeated attempts.",
    );
    expect(alert.textContent).toContain("STAGE_ANIMATION_FAILED");

    fireEvent.click(screen.getByRole("button", { name: "Retry failed stage" }));

    const retryCall = findCall(
      fetchMock,
      "/api/productions/prod-e52/retry",
      "POST",
    );
    expect(retryCall).toBeDefined();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("surfaces the API's retry refusal without losing the failure context", async () => {
    installFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url === "/api/productions/prod-e52") {
        return jsonResponse(200, failedDetail());
      }
      if (
        url === "/api/productions/prod-e52/retry" &&
        method.toUpperCase() === "POST"
      ) {
        return jsonResponse(409, {
          error: {
            code: "ILLEGAL_TRANSITION",
            message: "Only failed productions can be retried.",
          },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    fireEvent.click(screen.getByRole("button", { name: "Retry failed stage" }));

    await screen.findByText(/Only failed productions can be retried\./);
    // The original safe failure stays visible while the action error shows.
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) =>
          alert.textContent.includes(
            "The animation stage failed after repeated attempts.",
          ),
        ),
    ).toBe(true);
  });

  it("renders artifact lineage from source to final video with safe links", async () => {
    installFetch(async () => jsonResponse(200, completeDetail()));
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    const lineage = await screen.findByLabelText(
      "Artifact lineage from source to final video",
    );
    const links = Array.from(lineage.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual([
      "Source video",
      "Final video",
    ]);
    expect(links[0]?.getAttribute("href")).toBe(
      "/api/productions/prod-e52/artifacts/prod-e52-source",
    );
    expect(links[1]?.getAttribute("href")).toBe(
      "/api/productions/prod-e52/artifacts/prod-e52-final",
    );
    expect(lineage.textContent).toContain(SHA.slice(0, 12));
    expect(lineage.textContent).toContain("FFmpeg");
  });

  it("previews the final video with probed facts and a download link", async () => {
    installFetch(async () => jsonResponse(200, completeDetail()));
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    const preview = await screen.findByTestId("output-preview");
    expect(preview.getAttribute("src")).toBe(
      "/api/productions/prod-e52/artifacts/prod-e52-final",
    );

    const facts = screen.getByLabelText("Output facts");
    expect(facts.textContent).toContain("6.2s");
    expect(facts.textContent).toContain("1080 × 1920");
    expect(facts.textContent).toContain("AVC1");
    expect(facts.textContent).toContain("Present");

    const download = screen.getByTestId("download-final");
    expect(download.getAttribute("href")).toBe(
      "/api/productions/prod-e52/artifacts/prod-e52-final?download=1",
    );
  });

  it("records an approval, locking the decision buttons while it persists", async () => {
    let resolveDecision: (response: Response) => void = () => {};
    const decisionPromise = new Promise<Response>((resolve) => {
      resolveDecision = resolve;
    });
    const fetchMock = installFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url === "/api/productions/prod-e52") {
        return jsonResponse(200, completeDetail());
      }
      if (
        url === "/api/productions/prod-e52/decision" &&
        method.toUpperCase() === "POST"
      ) {
        return decisionPromise;
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    fireEvent.click(screen.getByRole("button", { name: "Approve output" }));

    const decisionCall = findCall(
      fetchMock,
      "/api/productions/prod-e52/decision",
      "POST",
    );
    expect(decisionCall).toBeDefined();
    expect(JSON.parse(decisionCall![1]?.body as string)).toEqual({
      decision: "APPROVED",
    });
    await screen.findByText(
      "Decision buttons lock while a decision is being recorded.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Recording approval…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    resolveDecision(
      jsonResponse(
        200,
        completeDetail({
          detail: {
            outputDecision: {
              decision: "APPROVED",
              decidedAt: ISO,
            },
          },
        }),
      ),
    );
    await screen.findByText("Output approved");
    expect(screen.queryByText(/Decision buttons lock/)).toBeNull();
  });

  it("records a reasoned rejection and shows the persisted note", async () => {
    const fetchMock = installFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url === "/api/productions/prod-e52") {
        return jsonResponse(200, completeDetail());
      }
      if (
        url === "/api/productions/prod-e52/decision" &&
        method.toUpperCase() === "POST"
      ) {
        return jsonResponse(
          200,
          completeDetail({
            detail: {
              outputDecision: {
                decision: "REJECTED",
                reason: "Tighten the timing on the punchline.",
                decidedAt: ISO,
              },
            },
          }),
        );
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    renderMonitor();

    await screen.findByRole("heading", { name: "Job monitor" });
    fireEvent.click(screen.getByRole("button", { name: "Reject output" }));

    fireEvent.change(screen.getByLabelText("Rejection note (optional)"), {
      target: { value: "Tighten the timing on the punchline." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));

    const decisionCall = findCall(
      fetchMock,
      "/api/productions/prod-e52/decision",
      "POST",
    );
    expect(JSON.parse(decisionCall![1]?.body as string)).toEqual({
      decision: "REJECTED",
      reason: "Tighten the timing on the punchline.",
    });
    await screen.findByText("Output rejected");
    expect(
      screen.getByText(/Note: Tighten the timing on the punchline\./),
    ).toBeTruthy();
  });

  it("surfaces load failures and recovers through Try again", async () => {
    const fetchMock = installFetch(async () => {
      throw new TypeError("network down");
    });
    renderMonitor();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The job could not be loaded");

    fetchMock.mockImplementation(async (url, init) => {
      const method = init?.method ?? "GET";
      if (String(url).includes("/api/agent-trace")) {
        return jsonResponse(200, { runs: [] });
      }
      if (url === "/api/productions/prod-e52") {
        return jsonResponse(200, completeDetail());
      }
      throw new Error(`Unexpected request: ${method} ${String(url)}`);
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Job monitor" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("returns to the setup flow through the back control", async () => {
    installFetch(async () => jsonResponse(200, completeDetail()));
    const onBack = vi.fn();
    renderMonitor(onBack);

    await screen.findByRole("heading", { name: "Job monitor" });
    fireEvent.click(screen.getByRole("button", { name: "← Production setup" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

function chainDetail() {
  return makeDetail({
    status: "COMPLETE",
    detail: {
      stages: STAGE_NAMES.map((name) =>
        makeStage({ id: `stage-${name}`, name, status: "COMPLETE" }),
      ),
      artifacts: [
        makeArtifact({ id: "prod-e52-source" }),
        makeArtifact({
          id: "prod-e52-key",
          kind: "KEYFRAME",
          provider: "MOCK",
        }),
        makeArtifact({
          id: "prod-e52-clay",
          kind: "STYLED_FRAME",
          provider: "MOCK",
        }),
        makeArtifact({
          id: "prod-e52-anim",
          kind: "SILENT_ANIMATION",
          provider: "MOCK",
        }),
        COMPLETE_FINAL_ARTIFACT,
      ],
    },
  });
}

function failedDetail() {
  return makeDetail({
    status: "FAILED",
    errorCode: "STAGE_ANIMATION_FAILED",
    safeErrorMessage:
      "The animation stage failed after repeated attempts. Retry from the last completed step.",
    detail: {
      stages: [
        makeStage({
          id: "stage-ingest",
          name: "INGEST_SOURCE",
          status: "COMPLETE",
        }),
        makeStage({
          id: "stage-animate",
          name: "ANIMATE_IMAGE",
          status: "FAILED",
          errorCode: "STAGE_ANIMATION_FAILED",
          safeErrorMessage:
            "The animation stage failed after repeated attempts. Retry from the last completed step.",
        }),
      ],
    },
  });
}

describe("JobOutput visual chain", () => {
  it("draws the visual chain from artifact lineage in pipeline order", async () => {
    installFetch(async () => jsonResponse(200, chainDetail()));
    renderMonitor();

    const chain = await screen.findByLabelText(
      "Keyframe, clay frame, animation, and final video",
    );
    const steps = Array.from(chain.querySelectorAll("li"));
    expect(steps.map((step) => step.textContent)).toEqual([
      "Keyframe",
      "Clay frame",
      "Animation",
      "Final",
    ]);
    // Non-chain artifacts (source video) never appear in the strip.
    expect(chain.textContent).not.toContain("Source video");
    expect(
      chain.querySelector(
        'img[src="/api/productions/prod-e52/artifacts/prod-e52-key"]',
      ),
    ).not.toBeNull();
  });
});
