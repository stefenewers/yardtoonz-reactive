import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";

let fixtureDirectory: string;

const liveAdapterConfig = {
  DIRECTOR_PROVIDER: "OPENAI",
  OPENAI_API_KEY: "test-director-key",
  OPENAI_DIRECTOR_MODEL: "gpt-4.1-mini-test",
};

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-director-live-"),
  );
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "director-live.sqlite",
  )}`;

  // The service captures provider selection when the shared env module
  // first parses process.env, so the LIVE environment must be complete
  // before any server module graph is imported.
  process.env.DIRECTOR_PROVIDER = liveAdapterConfig.DIRECTOR_PROVIDER;
  process.env.OPENAI_API_KEY = liveAdapterConfig.OPENAI_API_KEY;
  process.env.OPENAI_DIRECTOR_MODEL = liveAdapterConfig.OPENAI_DIRECTOR_MODEL;

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  getCandidateRepository().seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
});

afterAll(async () => {
  delete process.env.DIRECTOR_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_DIRECTOR_MODEL;
  await rm(fixtureDirectory, { recursive: true, force: true });
});

function chatCompletionFetch(treatment: unknown, requestId: string) {
  return vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(treatment),
              },
            },
          ],
        }),
        { status: 200, headers: { "x-request-id": requestId } },
      ),
  );
}

describe("director treatment service (OPENAI live wiring)", () => {
  it("creates a live treatment and persists provider, model, and request ID", async () => {
    const { directorTreatmentSchema } = await import(
      "../../src/domain/director"
    );
    const treatment = directorTreatmentSchema.parse({
      humorMechanism:
        "Expectation subversion: the caption promises a familiar routine and the payoff breaks it at the last beat.",
      audienceReactionEvidence: [
        { source: "comment", quote: "lol the dog is dead", weight: 0.9 },
      ],
      recommendedSegment: { startSeconds: 0, endSeconds: 6 },
      setupTimestamp: 1.5,
      payoffTimestamp: 4.2,
      adaptationConcept:
        "A rain-soaked clay gate dash in the Yard Toonz style.",
      claymationPrompt: "Claymation keyframe, hand-molded plasticine, 9:16.",
      motionPrompt: "Slow push-in with subtle stop-motion jitter.",
      socialCaption: "When the rain catches you at the gate. Rebuilt in clay.",
      confidence: 0.62,
      risks: [],
      evidenceGaps: [],
    });

    const fetchImpl = chatCompletionFetch(treatment, "req_live_001");
    vi.stubGlobal("fetch", fetchImpl);

    const { getDirectorTreatmentService } = await import(
      "../../src/server/director/service"
    );
    const service = getDirectorTreatmentService();
    const candidateId = candidateFixtures[7]!.id;

    const outcome = await service.create({ candidateId });
    expect(outcome).not.toBe("CANDIDATE_NOT_FOUND");

    const resource = outcome as Exclude<typeof outcome, "CANDIDATE_NOT_FOUND">;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resource.provider).toBe("OPENAI");
    expect(resource.model).toBe(liveAdapterConfig.OPENAI_DIRECTOR_MODEL);
    expect(resource.providerRequestId).toBe("req_live_001");

    // Attribution round-trips through persistence, not just the response.
    expect(service.get(resource.id)).toEqual(resource);

    // A repeat request reuses the persisted fingerprint without a new call.
    await service.create({ candidateId });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("surfaces TREATMENT_UNRESOLVED on a network failure and refuses the blind retry", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    vi.stubGlobal("fetch", fetchImpl);

    const { getDirectorTreatmentService, DirectorTreatmentError } =
      await import("../../src/server/director/service");
    const service = getDirectorTreatmentService();
    const candidateId = candidateFixtures[8]!.id;

    const outcome = await service
      .create({ candidateId })
      .catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(DirectorTreatmentError);
    expect((outcome as { code: string }).code).toBe("TREATMENT_UNRESOLVED");

    // The fingerprint is poisoned: a second call must not silently re-pay.
    await expect(service.create({ candidateId })).rejects.toThrow(
      DirectorTreatmentError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
