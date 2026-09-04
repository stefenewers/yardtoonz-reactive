import { describe, expect, it } from "vitest";

import {
  buildAttributionAudit,
  buildCredentialGateStates,
  buildProviderStatusCards,
  buildRequestIdTimeline,
} from "../../src/domain/diagnostics";
import type {
  DiagnosticsEnvironment,
  DiagnosticsJob,
} from "../../src/shared/diagnostics";

const ISO_A = "2026-09-03T12:00:00.000Z";
const ISO_B = "2026-09-03T12:01:00.000Z";
const ISO_C = "2026-09-03T12:02:00.000Z";

function environment(
  overrides: Partial<DiagnosticsEnvironment["credentials"]> = {},
): DiagnosticsEnvironment {
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

describe("buildCredentialGateStates", () => {
  it("reports mock selections as credential-free with no requirements", () => {
    const [image, animation, director] = buildCredentialGateStates({
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
    });

    expect(image.outcome).toBe("CREDENTIAL_FREE");
    expect(image.requiredSettings).toEqual([]);
    expect(image.outcomeLabel).toBe("Credential-free");
    expect(animation.outcome).toBe("CREDENTIAL_FREE");
    expect(director.outcome).toBe("CREDENTIAL_FREE");
  });

  it("reports a live selection with every credential present as ready", () => {
    const [image, animation, director] =
      buildCredentialGateStates(environment());

    expect(image.selectedProvider).toBe("OPENAI");
    expect(image.isLive).toBe(true);
    expect(image.requiredSettings).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_IMAGE_MODEL",
    ]);
    expect(image.missingSettings).toEqual([]);
    expect(image.outcome).toBe("READY");
    expect(image.outcomeLabel).toBe("Credentials ready");
    expect(animation.requiredSettings).toEqual([
      "RUNWAY_API_KEY",
      "RUNWAY_MODEL",
    ]);
    expect(animation.outcome).toBe("READY");
    expect(director.outcome).toBe("READY");
  });

  it("fails fast when a live selection is missing required settings", () => {
    const [image, animation] = buildCredentialGateStates(
      environment({
        OPENAI_IMAGE_MODEL: false,
        RUNWAY_API_KEY: false,
        RUNWAY_MODEL: false,
      }),
    );

    expect(image.outcome).toBe("FAILS_FAST");
    expect(image.missingSettings).toEqual(["OPENAI_IMAGE_MODEL"]);
    expect(image.presentSettings).toEqual(["OPENAI_API_KEY"]);
    expect(animation.outcome).toBe("FAILS_FAST");
    expect(animation.missingSettings).toEqual([
      "RUNWAY_API_KEY",
      "RUNWAY_MODEL",
    ]);
  });
});

function job(overrides: Partial<DiagnosticsJob> = {}): DiagnosticsJob {
  return {
    id: "prod-1",
    candidateId: "cand-1",
    status: "COMPLETE",
    imageProvider: "OPENAI",
    animationProvider: "MOCK",
    attempt: 1,
    createdAt: ISO_A,
    updatedAt: ISO_C,
    stages: [],
    artifacts: [],
    ...overrides,
  };
}

describe("buildProviderStatusCards", () => {
  it("summarizes artifacts by producer and flags unservable selections", () => {
    const cards = buildProviderStatusCards(
      [
        job({
          artifacts: [
            {
              id: "a1",
              kind: "STYLED_FRAME",
              provider: "OPENAI",
              providerRequestId: "req-1",
              createdAt: ISO_B,
            },
            {
              id: "a2",
              kind: "SOURCE_VIDEO",
              provider: "USER_UPLOAD",
              createdAt: ISO_A,
            },
            {
              id: "a3",
              kind: "SILENT_ANIMATION",
              provider: "RUNWAY",
              createdAt: ISO_C,
            },
          ],
        }),
      ],
      environment(),
    );

    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.liveAttributedCount).toBe(1);
    expect(card.localCount).toBe(1);
    expect(card.unattributedLiveCount).toBe(1);
    expect(card.environmentStillServable).toBe(true);
  });

  it("marks persisted live selections unservable when credentials vanish", () => {
    const cards = buildProviderStatusCards(
      [job()],
      environment({ OPENAI_API_KEY: false, OPENAI_IMAGE_MODEL: false }),
    );

    expect(cards[0]!.environmentStillServable).toBe(false);
  });
});

describe("buildAttributionAudit", () => {
  it("returns an empty, complete audit with no artifacts", () => {
    const audit = buildAttributionAudit([job()]);

    expect(audit.rows).toEqual([]);
    expect(audit.totals).toEqual({
      artifacts: 0,
      liveAttributed: 0,
      local: 0,
      unattributedLive: 0,
    });
    expect(audit.complete).toBe(true);
  });

  it("classifies live, local, and unattributed artifacts newest first", () => {
    const audit = buildAttributionAudit([
      job({
        artifacts: [
          {
            id: "live-1",
            kind: "STYLED_FRAME",
            provider: "OPENAI",
            providerRequestId: "img_req_1",
            createdAt: ISO_A,
          },
          {
            id: "upload-1",
            kind: "SOURCE_VIDEO",
            provider: "USER_UPLOAD",
            createdAt: ISO_B,
          },
          {
            id: "live-2",
            kind: "SILENT_ANIMATION",
            provider: "RUNWAY",
            createdAt: ISO_C,
          },
        ],
      }),
    ]);

    expect(audit.rows.map((row) => row.artifactId)).toEqual([
      "live-2",
      "upload-1",
      "live-1",
    ]);
    expect(audit.totals).toEqual({
      artifacts: 3,
      liveAttributed: 1,
      local: 1,
      unattributedLive: 1,
    });
    expect(audit.complete).toBe(false);
    expect(audit.rows[0]!.verdictLabel).toBe("Missing request ID");
    expect(audit.rows[1]!.verdictLabel).toBe("Local producer");
  });
});

describe("buildRequestIdTimeline", () => {
  it("orders observed stages and artifacts chronologically", () => {
    const timeline = buildRequestIdTimeline(
      job({
        stages: [
          {
            id: "s1",
            name: "INGEST_SOURCE",
            status: "COMPLETE",
            attempt: 1,
            startedAt: ISO_A,
            completedAt: ISO_A,
          },
          {
            id: "s2",
            name: "STYLE_IMAGE",
            status: "COMPLETE",
            attempt: 1,
            startedAt: ISO_B,
            completedAt: ISO_B,
            providerRequestId: "img_req_1",
          },
          {
            id: "s3",
            name: "ANIMATE_IMAGE",
            status: "WAITING",
            attempt: 1,
          },
        ],
        artifacts: [
          {
            id: "a1",
            kind: "STYLED_FRAME",
            provider: "OPENAI",
            providerRequestId: "img_req_1",
            createdAt: ISO_B,
          },
        ],
      }),
    );

    expect(
      timeline.map((event) => `${event.source}:${event.detailLabel}`),
    ).toEqual([
      "stage:Ingest Source",
      "stage:Style Image",
      "artifact:Styled frame",
    ]);
    expect(timeline[1]!.providerRequestId).toBe("img_req_1");
    expect(timeline[2]!.hasRequestId).toBe(true);
  });

  it("returns an empty timeline before any stage completes", () => {
    const timeline = buildRequestIdTimeline(
      job({
        stages: [
          {
            id: "s1",
            name: "INGEST_SOURCE",
            status: "WAITING",
            attempt: 1,
          },
        ],
      }),
    );

    expect(timeline).toEqual([]);
  });
});
