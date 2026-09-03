import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { mediaToolPaths } from "../../src/lib/media-tools";

const execFileAsync = promisify(execFile);

let fixtureDirectory: string;
let fixtureBytes: Uint8Array;
let fixtureFilePart: ArrayBuffer;
let approvedCandidateId: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-prod-api-"));
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "productions.sqlite",
  )}`;

  const fixturePath = path.join(fixtureDirectory, "authorized-source.mp4");
  await execFileAsync(mediaToolPaths.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "6.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    fixturePath,
  ]);
  fixtureBytes = await readFile(fixturePath);
  // File parts need a dedicated ArrayBuffer copy of the fixture bytes.
  fixtureFilePart = new Uint8Array(fixtureBytes).buffer as ArrayBuffer;

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  const candidates = getCandidateRepository();
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  approvedCandidateId = candidateFixtures[0]!.id;
  candidates.approve(approvedCandidateId, "2026-09-03T12:01:00.000Z");
  candidates.confirmRights({
    candidateId: approvedCandidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

const productionsUrl = "http://localhost/api/productions";

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

const segment = {
  startSeconds: 0,
  endSeconds: 6,
  durationSeconds: 6,
};

describe("production API flow", () => {
  it("creates a draft for an approved candidate and returns the detail", async () => {
    const { POST } = await import("../../src/app/api/productions/route");
    const response = await POST(
      jsonRequest(
        { candidateId: approvedCandidateId, segment },
        "POST",
        productionsUrl,
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      production: { id: string; status: string };
    };
    expect(body.production.status).toBe("DRAFT");
  });

  it("rejects drafts for unapproved or unknown candidates", async () => {
    const { POST } = await import("../../src/app/api/productions/route");
    const unapproved = await POST(
      jsonRequest(
        { candidateId: candidateFixtures[1]!.id, segment },
        "POST",
        productionsUrl,
      ),
    );
    expect(await errorOf(unapproved)).toEqual({
      code: "CANDIDATE_NOT_APPROVED",
      status: 409,
    });

    const unknown = await POST(
      jsonRequest(
        { candidateId: "candidate-nope", segment },
        "POST",
        productionsUrl,
      ),
    );
    expect(await errorOf(unknown)).toEqual({
      code: "CANDIDATE_NOT_FOUND",
      status: 404,
    });
  });

  it("serves detail by id and answers unknown ids with a stable 404", async () => {
    const { POST } = await import("../../src/app/api/productions/route");
    const { GET } = await import("../../src/app/api/productions/[id]/route");
    const created = await POST(
      jsonRequest(
        { candidateId: approvedCandidateId, segment },
        "POST",
        productionsUrl,
      ),
    );
    const { production } = (await created.json()) as {
      production: { id: string };
    };

    const detail = await GET(new Request(productionsUrl), {
      params: Promise.resolve({ id: production.id }),
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      production: { id: string; status: string };
    };
    expect(body.production.id).toBe(production.id);

    const missing = await GET(new Request(productionsUrl), {
      params: Promise.resolve({ id: "prod_missing" }),
    });
    expect(await errorOf(missing)).toEqual({
      code: "PRODUCTION_NOT_FOUND",
      status: 404,
    });
  });

  it("walks draft → rights → upload → queued through the API and rejects re-starts", async () => {
    const { POST: createProduction } = await import(
      "../../src/app/api/productions/route"
    );
    const { GET: getProduction, PATCH: patchProduction } = await import(
      "../../src/app/api/productions/[id]/route"
    );
    const { POST: uploadSource } = await import(
      "../../src/app/api/productions/[id]/source/route"
    );
    const { POST: startProduction } = await import(
      "../../src/app/api/productions/[id]/start/route"
    );

    const created = await createProduction(
      jsonRequest(
        { candidateId: approvedCandidateId, segment },
        "POST",
        productionsUrl,
      ),
    );
    const { production } = (await created.json()) as {
      production: { id: string };
    };
    const id = production.id;
    const routeContext = { params: Promise.resolve({ id }) };

    const confirmed = await patchProduction(
      jsonRequest(
        {
          rights: { confirmed: true, confirmationTextVersion: "rights-v1" },
        },
        "PATCH",
        `${productionsUrl}/${id}`,
      ),
      routeContext,
    );
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()) as {
      production: { status: string };
    };
    expect(confirmedBody.production.status).toBe("RIGHTS_CONFIRMED");

    const startedWithoutSource = await startProduction(
      new Request(`${productionsUrl}/${id}`, { method: "POST" }),
      routeContext,
    );
    expect(await errorOf(startedWithoutSource)).toEqual({
      code: "SOURCE_REQUIRED",
      status: 409,
    });

    const invalidUpload = await uploadSource(
      new Request(`${productionsUrl}/${id}/source`, {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append(
            "source",
            new File([new Uint8Array([0, 1, 2, 3])], "source.mp4", {
              type: "video/mp4",
            }),
          );
          return form;
        })(),
      }),
      routeContext,
    );
    expect(await errorOf(invalidUpload)).toEqual({
      code: "INVALID_MEDIA_CONTENT",
      status: 400,
    });

    const upload = await uploadSource(
      new Request(`${productionsUrl}/${id}/source`, {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append(
            "source",
            new File([fixtureFilePart], "source.mp4", { type: "video/mp4" }),
          );
          return form;
        })(),
      }),
      routeContext,
    );
    expect(upload.status).toBe(201);
    const uploadedBody = (await upload.json()) as {
      production: { status: string };
      stages: { name: string; status: string }[];
      artifacts: { kind: string }[];
    };
    expect(uploadedBody.production.status).toBe("RIGHTS_CONFIRMED");
    expect(
      uploadedBody.stages.some(
        (stage) =>
          stage.name === "INGEST_SOURCE" && stage.status === "COMPLETE",
      ),
    ).toBe(true);
    expect(
      uploadedBody.artifacts.some(
        (artifact) => artifact.kind === "SOURCE_VIDEO",
      ),
    ).toBe(true);

    const started = await startProduction(
      new Request(`${productionsUrl}/${id}/start`, { method: "POST" }),
      routeContext,
    );
    expect(started.status).toBe(200);
    const startedBody = (await started.json()) as {
      production: { status: string };
    };
    expect(startedBody.production.status).toBe("QUEUED");

    const restart = await startProduction(
      new Request(`${productionsUrl}/${id}/start`, { method: "POST" }),
      routeContext,
    );
    expect(await errorOf(restart)).toEqual({
      code: "ILLEGAL_TRANSITION",
      status: 409,
    });

    const editAfterQueue = await patchProduction(
      jsonRequest(
        { creativeDirection: "more clay" },
        "PATCH",
        `${productionsUrl}/${id}`,
      ),
      routeContext,
    );
    expect(await errorOf(editAfterQueue)).toEqual({
      code: "ILLEGAL_TRANSITION",
      status: 409,
    });

    const detail = await getProduction(
      new Request(productionsUrl),
      routeContext,
    );
    const detailBody = (await detail.json()) as {
      production: { status: string };
    };
    expect(detailBody.production.status).toBe("QUEUED");
  });

  it("keeps a second job from starting while one is active", async () => {
    // A dedicated candidate keeps this test independent from the earlier
    // queued production, which still occupies its own candidate's job slot.
    const { getCandidateRepository } = await import(
      "../../src/server/candidates/service"
    );
    const singleJobCandidateId = candidateFixtures[1]!.id;
    const candidates = getCandidateRepository();
    candidates.approve(singleJobCandidateId, "2026-09-03T12:05:00.000Z");
    candidates.confirmRights({
      candidateId: singleJobCandidateId,
      confirmedAt: "2026-09-03T12:06:00.000Z",
      confirmationTextVersion: "rights-v1",
    });

    const { POST: createProduction } = await import(
      "../../src/app/api/productions/route"
    );
    const { PATCH: patchProduction } = await import(
      "../../src/app/api/productions/[id]/route"
    );
    const { POST: uploadSource } = await import(
      "../../src/app/api/productions/[id]/source/route"
    );
    const { POST: startProduction } = await import(
      "../../src/app/api/productions/[id]/start/route"
    );

    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await createProduction(
        jsonRequest(
          { candidateId: singleJobCandidateId, segment },
          "POST",
          productionsUrl,
        ),
      );
      const { production } = (await created.json()) as {
        production: { id: string };
      };
      ids.push(production.id);
      const context = { params: Promise.resolve({ id: production.id }) };
      await patchProduction(
        jsonRequest(
          { rights: { confirmed: true, confirmationTextVersion: "rights-v1" } },
          "PATCH",
          `${productionsUrl}/${production.id}`,
        ),
        context,
      );
      await uploadSource(
        new Request(`${productionsUrl}/${production.id}/source`, {
          method: "POST",
          body: (() => {
            const form = new FormData();
            form.append(
              "source",
              new File([fixtureFilePart], "source.mp4", { type: "video/mp4" }),
            );
            return form;
          })(),
        }),
        context,
      );
    }

    const first = await startProduction(
      new Request(`${productionsUrl}/${ids[0]}/start`, { method: "POST" }),
      { params: Promise.resolve({ id: ids[0]! }) },
    );
    expect(first.status).toBe(200);

    const second = await startProduction(
      new Request(`${productionsUrl}/${ids[1]}/start`, { method: "POST" }),
      { params: Promise.resolve({ id: ids[1]! }) },
    );
    expect(await errorOf(second)).toEqual({
      code: "PRODUCTION_ALREADY_ACTIVE",
      status: 409,
    });
  });
});

describe("provider credential gating", () => {
  afterEach(() => {
    for (const key of [
      "OPENAI_API_KEY",
      "OPENAI_IMAGE_MODEL",
      "RUNWAY_API_KEY",
      "RUNWAY_MODEL",
    ]) {
      delete process.env[key];
    }
  });

  async function listProductionCount(): Promise<number> {
    const { GET } = await import("../../src/app/api/productions/route");
    const response = await GET(
      new Request(`${productionsUrl}?candidateId=${approvedCandidateId}`),
    );
    const body = (await response.json()) as {
      productions: { id: string }[];
    };
    return body.productions.length;
  }

  it("fails fast with 400 when OPENAI is selected without credentials", async () => {
    const { POST } = await import("../../src/app/api/productions/route");
    const before = await listProductionCount();

    const response = await POST(
      jsonRequest(
        {
          candidateId: approvedCandidateId,
          segment,
          imageProvider: "OPENAI",
        },
        "POST",
        productionsUrl,
      ),
    );

    expect(await errorOf(response)).toEqual({
      code: "PROVIDER_CREDENTIALS_REQUIRED",
      status: 400,
    });
    // The validation happens before the draft is persisted.
    expect(await listProductionCount()).toBe(before);
  });

  it("fails fast with 400 when RUNWAY is selected without credentials", async () => {
    const { POST } = await import("../../src/app/api/productions/route");

    const response = await POST(
      jsonRequest(
        {
          candidateId: approvedCandidateId,
          segment,
          animationProvider: "RUNWAY",
        },
        "POST",
        productionsUrl,
      ),
    );

    expect(await errorOf(response)).toEqual({
      code: "PROVIDER_CREDENTIALS_REQUIRED",
      status: 400,
    });
  });

  it("accepts mock selections with no provider settings configured", async () => {
    const { POST } = await import("../../src/app/api/productions/route");

    const response = await POST(
      jsonRequest(
        {
          candidateId: approvedCandidateId,
          segment,
          imageProvider: "MOCK",
          animationProvider: "MOCK",
        },
        "POST",
        productionsUrl,
      ),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      production: { imageProvider: string; animationProvider: string };
    };
    expect(body.production.imageProvider).toBe("MOCK");
    expect(body.production.animationProvider).toBe("MOCK");
  });
});
