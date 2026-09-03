import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import type { DirectorTreatmentResource } from "../../src/domain/director";

/** Narrows the service's create outcome so typecheck sees the resource. */
function treatmentOf(
  outcome: DirectorTreatmentResource | "CANDIDATE_NOT_FOUND",
): DirectorTreatmentResource {
  if (outcome === "CANDIDATE_NOT_FOUND") {
    throw new Error("Expected a treatment, received CANDIDATE_NOT_FOUND");
  }
  return outcome;
}

let fixtureDirectory: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "yardtoonz-director-api-"),
  );
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "director-treatments.sqlite",
  )}`;

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  const candidates = getCandidateRepository();
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

const treatmentsUrl = "http://localhost/api/director/treatments";

function jsonRequest(body: unknown, method: string, url: string): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorOf(response: Response): Promise<{
  code: string;
  status: number;
}> {
  const body = (await response.json()) as { error?: { code?: string } };
  return { code: body.error?.code ?? "no-code", status: response.status };
}

describe("director treatment API flow", () => {
  it("creates a treatment for a seeded candidate and returns the resource", async () => {
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    const candidateId = candidateFixtures[0]!.id;
    const response = await POST(
      jsonRequest({ candidateId }, "POST", treatmentsUrl),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      treatment: {
        id: string;
        candidateId: string;
        provider: string;
        treatment: Record<string, unknown>;
      };
    };
    expect(body.treatment.id).toBe(`treat_${candidateId}`);
    expect(body.treatment.candidateId).toBe(candidateId);
    expect(body.treatment.provider).toBe("MOCK");
    expect(body.treatment.treatment.humorMechanism).toBeTruthy();
    expect(Array.isArray(body.treatment.treatment.evidenceGaps)).toBe(true);
  });

  it("returns the same persisted treatment on a repeated create", async () => {
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    const candidateId = candidateFixtures[0]!.id;
    const request = jsonRequest({ candidateId }, "POST", treatmentsUrl);

    const first = await POST(request);
    const second = await POST(
      jsonRequest({ candidateId }, "POST", treatmentsUrl),
    );
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
  });

  it("returns CANDIDATE_NOT_FOUND for an unknown candidate", async () => {
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    const response = await POST(
      jsonRequest({ candidateId: "cand_missing" }, "POST", treatmentsUrl),
    );
    const { code, status } = await errorOf(response);
    expect(status).toBe(404);
    expect(code).toBe("CANDIDATE_NOT_FOUND");
  });

  it("rejects an invalid create body with INVALID_REQUEST", async () => {
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    const response = await POST(
      jsonRequest({ candidateId: "" }, "POST", treatmentsUrl),
    );
    const { code, status } = await errorOf(response);
    expect(status).toBe(400);
    expect(code).toBe("INVALID_REQUEST");
  });

  it("gets a persisted treatment by id", async () => {
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    const candidateId = candidateFixtures[1]!.id;
    const created = await POST(
      jsonRequest({ candidateId }, "POST", treatmentsUrl),
    );
    const createdBody = (await created.json()) as { treatment: { id: string } };

    const { GET } = await import(
      "../../src/app/api/director/treatments/[id]/route"
    );
    const response = await GET(new Request(treatmentsUrl), {
      params: Promise.resolve({ id: createdBody.treatment.id }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      treatment: { id: string; candidateId: string };
    };
    expect(body.treatment).toEqual(createdBody.treatment);
  });

  it("returns TREATMENT_NOT_FOUND for an unknown treatment id", async () => {
    const { GET } = await import(
      "../../src/app/api/director/treatments/[id]/route"
    );
    const response = await GET(new Request(treatmentsUrl), {
      params: Promise.resolve({ id: "treat_nope" }),
    });
    const { code, status } = await errorOf(response);
    expect(status).toBe(404);
    expect(code).toBe("TREATMENT_NOT_FOUND");
  });

  it("returns a persisted treatment by candidate query and 404 without one", async () => {
    const { GET } = await import("../../src/app/api/director/treatments/route");
    const treated = candidateFixtures[2]!.id;
    const untreated = candidateFixtures[3]!.id;
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    await POST(jsonRequest({ candidateId: treated }, "POST", treatmentsUrl));

    const found = await GET(
      new Request(`${treatmentsUrl}?candidateId=${treated}`),
    );
    expect(found.status).toBe(200);
    const body = (await found.json()) as {
      treatment: { candidateId: string };
    };
    expect(body.treatment.candidateId).toBe(treated);

    const missing = await GET(
      new Request(`${treatmentsUrl}?candidateId=${untreated}`),
    );
    const { code, status } = await errorOf(missing);
    expect(status).toBe(404);
    expect(code).toBe("TREATMENT_NOT_FOUND");
  });

  it("requires a candidateId in the collection GET query", async () => {
    const { GET } = await import("../../src/app/api/director/treatments/route");
    const response = await GET(new Request(treatmentsUrl));
    const { code, status } = await errorOf(response);
    expect(status).toBe(400);
    expect(code).toBe("INVALID_REQUEST");
  });

  it("quotes only evidence the candidate actually carried", async () => {
    const { POST } = await import(
      "../../src/app/api/director/treatments/route"
    );
    const fixture = candidateFixtures[4]!;
    const response = await POST(
      jsonRequest({ candidateId: fixture.id }, "POST", treatmentsUrl),
    );
    const body = (await response.json()) as {
      treatment: {
        treatment: {
          audienceReactionEvidence: { quote: string; source: string }[];
        };
      };
    };

    const received = new Set([
      fixture.caption,
      ...(fixture.commentExcerpts ?? []),
    ]);
    for (const evidence of body.treatment.treatment.audienceReactionEvidence) {
      if (evidence.source === "metric") continue;
      expect(received.has(evidence.quote)).toBe(true);
    }
  });
});

describe("director treatment service", () => {
  it("persists a treatment that round-trips through get and getForCandidate", async () => {
    const { getDirectorTreatmentService } = await import(
      "../../src/server/director/service"
    );
    const service = getDirectorTreatmentService();
    const candidateId = candidateFixtures[5]!.id;

    const resource = treatmentOf(service.create({ candidateId }));

    expect(service.get(resource.id)).toEqual(resource);
    expect(service.getForCandidate(candidateId)).toEqual(resource);
  });

  it("surfaces evidence gaps when the candidate carries sparse evidence", async () => {
    const { getDirectorTreatmentService } = await import(
      "../../src/server/director/service"
    );
    const { getCandidateRepository } = await import(
      "../../src/server/candidates/service"
    );
    const service = getDirectorTreatmentService();

    const candidateId = "cand_director_sparse_e2e";
    getCandidateRepository().importIntake(
      [
        {
          id: candidateId,
          platform: "TIKTOK",
          sourceLabel: "@market_walk_ja",
          caption: "Market man says the price gone up again.",
          observedAt: "2026-09-03T12:00:00.000Z",
          metrics: {},
          commentExcerpts: [],
          adaptationNote: "Hold on the vendor's deadpan price repeat.",
          fitChecklist: {
            clearPremise: true,
            recognizableScenario: true,
            payoffWithinEightSeconds: true,
            authorizedAudio: true,
            visuallySimple: true,
            culturallyRelevant: true,
          },
        },
      ],
      "2026-09-03T12:00:00.000Z",
    );

    const resource = treatmentOf(service.create({ candidateId }));

    expect(
      resource.treatment.evidenceGaps.some((gap) =>
        gap.includes("comment excerpts"),
      ),
    ).toBe(true);
    expect(
      resource.treatment.evidenceGaps.some((gap) =>
        gap.includes("engagement metrics"),
      ),
    ).toBe(true);
    expect(resource.treatment.confidence).toBeLessThan(0.5);
  });

  it("returns CANDIDATE_NOT_FOUND from the service for an unknown candidate", async () => {
    const { getDirectorTreatmentService } = await import(
      "../../src/server/director/service"
    );
    expect(
      getDirectorTreatmentService().create({ candidateId: "cand_ghost" }),
    ).toBe("CANDIDATE_NOT_FOUND");
  });
});
