// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import {
  DiagnosticsDashboard,
  DIAGNOSTICS_POLL_INTERVAL_MS,
  deriveDiagnosticsView,
  type DiagnosticsView,
} from "../../src/components/diagnostics-dashboard";
import { createApiDiagnosticsClient } from "../../src/lib/diagnostics-client";
import type { DiagnosticsApiClient } from "../../src/lib/diagnostics-client";
import type { DiagnosticsResponse } from "../../src/shared/diagnostics";

const ISO_A = "2026-09-03T12:00:00.000Z";
const ISO_B = "2026-09-03T12:01:00.000Z";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function snapshotEnvironment(
  overrides: Partial<DiagnosticsResponse["environment"]["credentials"]> = {},
): DiagnosticsResponse["environment"] {
  return {
    imageProvider: "OPENAI",
    animationProvider: "RUNWAY",
    directorProvider: "OPENAI",
    credentials: {
      OPENAI_API_KEY: true,
      OPENAI_IMAGE_MODEL: true,
      OPENAI_DIRECTOR_MODEL: true,
      RUNWAY_API_KEY: true,
      RUNWAY_MODEL: true,
      ...overrides,
    },
  };
}

function clientWith(
  snapshot: Promise<DiagnosticsResponse> | Array<Promise<DiagnosticsResponse>>,
): { client: DiagnosticsApiClient; snapshotMock: ReturnType<typeof vi.fn> } {
  const queue = Array.isArray(snapshot) ? snapshot : [snapshot];
  const snapshotMock = vi.fn(() => {
    const next = queue.shift();
    if (!next) {
      throw new Error("unexpected extra snapshot request");
    }
    return next;
  }) as unknown as ReturnType<typeof vi.fn>;
  return {
    client: { getSnapshot: snapshotMock } as DiagnosticsApiClient,
    snapshotMock,
  };
}

function readyPayload(
  environment = snapshotEnvironment(),
): DiagnosticsResponse {
  return {
    environment,
    jobs: [
      {
        id: "prod-77",
        candidateId: "cand-7",
        status: "ANIMATING",
        imageProvider: "OPENAI",
        animationProvider: "RUNWAY",
        attempt: 2,
        createdAt: ISO_A,
        updatedAt: ISO_B,
        stages: [
          {
            id: "st-1",
            name: "STYLE_IMAGE",
            status: "COMPLETE",
            attempt: 2,
            startedAt: ISO_A,
            completedAt: ISO_B,
            providerRequestId: "img_req_77",
          },
        ],
        artifacts: [
          {
            id: "art-1",
            kind: "STYLED_FRAME",
            provider: "OPENAI",
            providerRequestId: "img_req_77",
            createdAt: ISO_B,
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DiagnosticsDashboard", () => {
  it("renders the loading state before the first snapshot resolves", async () => {
    const { client } = clientWith(
      new Promise<DiagnosticsResponse>(() => undefined),
    );
    render(<DiagnosticsDashboard client={client} pollIntervalMs={0} />);

    expect(screen.getByRole("status").textContent).toContain(
      "Loading provider diagnostics…",
    );
  });

  it("renders the fail-closed error state when the API is unreachable", async () => {
    const failing: DiagnosticsApiClient = {
      getSnapshot: () => Promise.reject(new Error("network down")),
    };
    render(<DiagnosticsDashboard client={failing} pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /unexpected problem/i,
      );
    });
  });

  it("renders mock gates as credential-free and the empty audit state", async () => {
    const { client } = clientWith(
      Promise.resolve({
        environment: {
          imageProvider: "MOCK",
          animationProvider: "MOCK",
          directorProvider: "MOCK",
          credentials: {
            OPENAI_API_KEY: false,
            OPENAI_IMAGE_MODEL: false,
            OPENAI_DIRECTOR_MODEL: false,
            RUNWAY_API_KEY: false,
            RUNWAY_MODEL: false,
          },
        },
        jobs: [],
      }),
    );
    render(<DiagnosticsDashboard client={client} pollIntervalMs={0} />);

    await waitFor(() => {
      expect(
        screen
          .getByTestId("diagnostics-gate-image")
          .getAttribute("data-outcome"),
      ).toBe("CREDENTIAL_FREE");
    });
    expect(
      screen
        .getByTestId("diagnostics-gate-animation")
        .getAttribute("data-outcome"),
    ).toBe("CREDENTIAL_FREE");
    expect(
      screen.getByTestId("diagnostics-attribution-empty").textContent,
    ).toMatch(/no artifacts recorded yet/i);
  });

  it("renders live gate readiness with setting names and no secret values", async () => {
    const { client } = clientWith(Promise.resolve(readyPayload()));
    render(<DiagnosticsDashboard client={client} pollIntervalMs={0} />);

    await waitFor(() => {
      expect(
        screen
          .getByTestId("diagnostics-gate-image")
          .getAttribute("data-outcome"),
      ).toBe("READY");
    });
    const imageGate = screen.getByTestId("diagnostics-gate-image");
    expect(imageGate.textContent).toContain("OPENAI_API_KEY");
    expect(imageGate.textContent).toContain("present");
    // The snapshot carries booleans only — a secret VALUE could never appear,
    // but assert the whole document too so a future regression is loud.
    expect(document.body.textContent).not.toContain("sk-");
    expect(
      screen.getByTestId("diagnostics-card-prod-77").textContent,
    ).toContain("OpenAI (live) · Runway (live)");
    expect(
      screen.getByText(/carry a provider request ID/i).textContent,
    ).toContain("All 1");
    // The timeline renders the request ID as a <code> element — once on the
    // stage event and once on the artifact event. Scope to the timeline (the
    // audit table shows the same ID in a plain cell) and assert every
    // occurrence is code-wrapped.
    const timeline = within(screen.getByTestId("diagnostics-timeline-prod-77"));
    const requestIdNodes = timeline.getAllByText("img_req_77");
    expect(requestIdNodes).toHaveLength(2);
    expect(requestIdNodes.every((element) => element.tagName === "CODE")).toBe(
      true,
    );
  });

  it("renders the invalid-credentials fail-fast state for missing settings", async () => {
    const { client } = clientWith(
      Promise.resolve(
        readyPayload(
          snapshotEnvironment({
            OPENAI_IMAGE_MODEL: false,
            RUNWAY_API_KEY: false,
          }),
        ),
      ),
    );
    render(<DiagnosticsDashboard client={client} pollIntervalMs={0} />);

    await waitFor(() => {
      expect(
        screen
          .getByTestId("diagnostics-gate-image")
          .getAttribute("data-outcome"),
      ).toBe("FAILS_FAST");
    });
    const imageGate = screen.getByTestId("diagnostics-gate-image");
    expect(imageGate.textContent).toContain("missing");
    expect(imageGate.textContent).toContain("Fails fast");
    expect(
      screen
        .getByTestId("diagnostics-gate-animation")
        .getAttribute("data-outcome"),
    ).toBe("FAILS_FAST");
  });

  it("keeps polling on the configured interval and survives unmount", async () => {
    const payload = readyPayload();
    const { client, snapshotMock } = clientWith([
      Promise.resolve(payload),
      Promise.resolve(payload),
    ]);
    const { unmount } = render(
      <DiagnosticsDashboard client={client} pollIntervalMs={30} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-refreshed").textContent).toContain(
        "Refreshed",
      );
    });

    // One interval tick later the second snapshot has been requested.
    await waitFor(() => {
      expect(snapshotMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Polling persistence: unmount cancels the interval without errors —
    // no further snapshot requests after unmount, whatever the tick was.
    unmount();
    const requestsAtUnmount = snapshotMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(snapshotMock.mock.calls.length).toBe(requestsAtUnmount);
  });

  it("exposes the default poll interval constant", () => {
    expect(DIAGNOSTICS_POLL_INTERVAL_MS).toBe(10_000);
  });

  it("degrades gracefully when the response violates the schema", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { unexpected: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiDiagnosticsClient();
    render(<DiagnosticsDashboard client={client} pollIntervalMs={0} />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /unreadable response/i,
      );
    });
    vi.unstubAllGlobals();
  });
});

describe("deriveDiagnosticsView", () => {
  it("derives a ready view from jobs and environment", () => {
    const payload = readyPayload();
    const view: DiagnosticsView = deriveDiagnosticsView(
      payload.jobs,
      payload.environment,
    );

    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.gates).toHaveLength(3);
    expect(view.cards[0]!.productionId).toBe("prod-77");
    expect(view.audit.totals.liveAttributed).toBe(1);
    expect(view.jobs).toHaveLength(1);
  });
});
