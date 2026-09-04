import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import type { ArtifactKind } from "../../src/domain/production";
import type { ArtifactProvider } from "../../src/lib/providers";
import { qaCheckResultSchema } from "../../src/shared/qa-reports";
import { openDatabase } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";

/**
 * The QA report suite binds the service and route singletons to a fresh
 * temporary database and artifact root by setting both environment variables
 * in beforeAll, before any env-importing module is loaded; modules are only
 * imported dynamically after that (see agent-trace-api.test.ts for the same
 * pattern). The final video's bytes are stored through a real local artifact
 * store so the download-readiness probe observes genuine storage state.
 */

let fixtureDirectory: string;

const NOW = new Date("2026-09-03T12:30:00.000Z");

const ARTIFACT_IDS: Record<ArtifactKind, string> = {
  SOURCE_VIDEO: "art_src",
  EXTRACTED_CLIP: "art_clip",
  EXTRACTED_AUDIO: "art_audio",
  KEYFRAME: "art_keyframe",
  STYLED_FRAME: "art_styled",
  SILENT_ANIMATION: "art_animation",
  FINAL_VIDEO: "art_final",
};

const ARTIFACT_ORDER = Object.keys(ARTIFACT_IDS) as ArtifactKind[];

const KIND_STAGE: Record<ArtifactKind, string> = {
  SOURCE_VIDEO: "INGEST_SOURCE",
  EXTRACTED_CLIP: "EXTRACT_MEDIA",
  EXTRACTED_AUDIO: "EXTRACT_MEDIA",
  KEYFRAME: "SELECT_KEYFRAME",
  STYLED_FRAME: "STYLE_IMAGE",
  SILENT_ANIMATION: "ANIMATE_IMAGE",
  FINAL_VIDEO: "MUX_AND_NORMALIZE",
};

const FINAL_VIDEO_METADATA = {
  durationSeconds: 6.0,
  width: 360,
  height: 640,
  videoCodec: "h264",
  audioCodec: "aac",
  audioPresent: true,
};

const KIND_PROVIDER: Record<ArtifactKind, ArtifactProvider> = {
  SOURCE_VIDEO: "USER_UPLOAD",
  EXTRACTED_CLIP: "FFMPEG",
  EXTRACTED_AUDIO: "FFMPEG",
  KEYFRAME: "FFMPEG",
  STYLED_FRAME: "MOCK",
  SILENT_ANIMATION: "MOCK",
  FINAL_VIDEO: "FFMPEG",
};

const KIND_METADATA: Record<ArtifactKind, Record<string, unknown>> = {
  SOURCE_VIDEO: {},
  EXTRACTED_CLIP: {
    durationSeconds: 6.0,
    width: 360,
    height: 640,
    videoCodec: "h264",
    audioCodec: "aac",
    audioPresent: true,
  },
  EXTRACTED_AUDIO: {
    durationSeconds: 6.0,
    audioCodec: "aac",
    audioPresent: true,
  },
  KEYFRAME: { sourceTimestampSeconds: 3 },
  STYLED_FRAME: { styledBy: "MOCK", styleVersion: "mock-style-v1" },
  SILENT_ANIMATION: {
    durationSeconds: 6.0,
    width: 360,
    height: 640,
    videoCodec: "h264",
    audioCodec: null,
    audioPresent: false,
    motion: "zoompan",
    fps: 24,
  },
  FINAL_VIDEO: FINAL_VIDEO_METADATA,
};

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "yardtoonz-qa-report-"));
  process.env.DATABASE_URL = `file:${path.join(
    fixtureDirectory,
    "qa-report.sqlite",
  )}`;
  process.env.ARTIFACT_ROOT = path.join(fixtureDirectory, "artifacts");

  const { getCandidateRepository } = await import(
    "../../src/server/candidates/service"
  );
  const candidates = getCandidateRepository();
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  candidates.approve(candidateFixtures[0]!.id, "2026-09-03T12:01:00.000Z");
  candidates.confirmRights({
    candidateId: candidateFixtures[0]!.id,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });

  // The Director's social caption completes the caption-presence check so
  // the happy-path production can pass all ten checks.
  const { getDirectorTreatmentService } = await import(
    "../../src/server/director/service"
  );
  const treatment = await getDirectorTreatmentService().create({
    candidateId: candidateFixtures[0]!.id,
  });
  if (treatment === "CANDIDATE_NOT_FOUND") {
    throw new Error("Expected the seeded candidate to accept a treatment");
  }
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

const candidateId = candidateFixtures[0]!.id;

async function qaServices() {
  const { getQaReportService } = await import("../../src/server/qa/service");
  return { qa: getQaReportService() };
}

async function qaRoute() {
  return import("../../src/app/api/productions/[id]/qa-report/route");
}

/**
 * Seeds a COMPLETE production for the fixture candidate, its seven pipeline
 * stages, and one artifact per stage with unit-fixture probe metadata. When
 * `storeFinalVideo` is true the final video's bytes are written through a
 * real artifact store; otherwise the storage key dangles.
 */
async function seedCompleteProduction(input: {
  productionId: string;
  storeFinalVideo: boolean;
}): Promise<void> {
  const database = openDatabase(process.env.DATABASE_URL!).database;

  const rightsRow = database
    .select({ id: schema.rightsConfirmations.id })
    .from(schema.rightsConfirmations)
    .where(eq(schema.rightsConfirmations.candidateId, candidateId))
    .get();
  if (!rightsRow) throw new Error("Expected a rights confirmation row");

  await database.insert(schema.productions).values({
    id: input.productionId,
    candidateId,
    rightsConfirmationId: rightsRow.id,
    status: "COMPLETE",
    imageProvider: "MOCK",
    animationProvider: "MOCK",
    segmentStartMs: 0,
    segmentEndMs: 6000,
    segmentDurationMs: 6000,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  });

  for (const name of schema.productionStageNames) {
    await database.insert(schema.productionStages).values({
      id: `stage_${input.productionId}_${name}`,
      productionId: input.productionId,
      name,
      status: "COMPLETE",
      startedAt: NOW,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  const { createLocalArtifactStore } = await import(
    "../../src/lib/artifact-store"
  );
  const store = createLocalArtifactStore();
  const finalVideoStorageKey = `qa-fixtures/${input.productionId}/final-video.mp4`;
  const finalBytes = new Uint8Array([0x51, 0x41, 0x52, 0x44]);
  let finalSha256 = "b".repeat(64);
  if (input.storeFinalVideo) {
    const stored = await store.save({
      bytes: finalBytes,
      storageKey: finalVideoStorageKey,
      mimeType: "video/mp4",
    });
    finalSha256 = stored.sha256;
  }

  for (const kind of ARTIFACT_ORDER) {
    const index = ARTIFACT_ORDER.indexOf(kind);
    const stage = KIND_STAGE[kind];
    const isFinal = kind === "FINAL_VIDEO";
    await database.insert(schema.artifacts).values({
      id: `${ARTIFACT_IDS[kind]}_${input.productionId}`,
      productionId: input.productionId,
      productionStageId: `stage_${input.productionId}_${stage}`,
      kind,
      storageKey: isFinal
        ? finalVideoStorageKey
        : `qa-fixtures/${input.productionId}/${kind.toLowerCase()}.bin`,
      mimeType: isFinal ? "video/mp4" : "application/octet-stream",
      byteSize: isFinal ? finalBytes.byteLength : 512,
      sha256: isFinal ? finalSha256 : "a".repeat(64),
      parentArtifactIdsJson: JSON.stringify(
        ARTIFACT_ORDER.slice(0, index).map(
          (parent) => `${ARTIFACT_IDS[parent]}_${input.productionId}`,
        ),
      ),
      provider: KIND_PROVIDER[kind],
      providerRequestId: null,
      metadataJson: JSON.stringify(KIND_METADATA[kind]),
      createdAt: NOW,
    });
  }
}

describe("QA report integration", () => {
  const reported = "prod-qa-reported";
  const missingStorage = "prod-qa-missing-storage";
  const unreported = "prod-qa-unreported";

  it("runs, persists, and traces a passing report", async () => {
    await seedCompleteProduction({
      productionId: reported,
      storeFinalVideo: true,
    });

    const { POST } = await qaRoute();
    const { qaReportResponseSchema } = await import(
      "../../src/shared/qa-reports"
    );

    const response = await POST(
      new Request("http://localhost/api/productions/x", { method: "POST" }),
      { params: Promise.resolve({ id: reported }) } as never,
    );
    expect(response.status).toBe(200);

    const body = qaReportResponseSchema.parse(await response.json());
    expect(body.report.productionId).toBe(reported);
    expect(body.report.overallStatus).toBe("PASS");
    expect(body.report.score).toBe(100);
    expect(body.report.checks.every((check) => check.status === "PASS")).toBe(
      true,
    );

    const database = openDatabase(process.env.DATABASE_URL!);
    const reportRow = database.sqlite
      .prepare("SELECT * FROM qa_reports WHERE production_id = ?")
      .get(reported) as
      | {
          id: string;
          overall_status: string;
          score: number;
          checks_json: string;
        }
      | undefined;
    expect(reportRow).toBeDefined();
    expect(reportRow!.overall_status).toBe("PASS");
    expect(reportRow!.score).toBe(100);
    expect(
      qaCheckResultSchema.array().parse(JSON.parse(reportRow!.checks_json)),
    ).toHaveLength(10);

    const traceRow = database.sqlite
      .prepare(
        "SELECT decision, artifact_ids_json FROM agent_runs WHERE agent_key = 'qa-inspector' AND production_id = ?",
      )
      .get(reported) as
      | { decision: string; artifact_ids_json: string }
      | undefined;
    expect(traceRow).toBeDefined();
    expect(traceRow!.decision).toContain("PASS at 100");
    expect(JSON.parse(traceRow!.artifact_ids_json)).toContain(
      `${ARTIFACT_IDS.FINAL_VIDEO}_${reported}`,
    );
    database.sqlite.close();
  });

  it("appends repeat runs as history, newest first", async () => {
    const { POST, GET } = await qaRoute();

    const second = await POST(
      new Request("http://localhost/api/productions/x", { method: "POST" }),
      { params: Promise.resolve({ id: reported }) } as never,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { report: { id: string } };

    const list = await GET(new Request("http://localhost/api/productions/x"), {
      params: Promise.resolve({ id: reported }),
    } as never);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { reports: { id: string }[] };
    expect(listBody.reports).toHaveLength(2);
    // The second run is the newest observation and leads the history.
    expect(listBody.reports[0]!.id).toBe(secondBody.report.id);
  });

  it("persists reports across a fresh database connection", async () => {
    // A brand-new connection to the same file sees the persisted rows —
    // the report survived the process that wrote it.
    const database = openDatabase(process.env.DATABASE_URL!);
    const rows = database.sqlite
      .prepare("SELECT id FROM qa_reports WHERE production_id = ?")
      .all(reported) as { id: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    database.sqlite.close();
  });

  it("fails download-readiness when the final video bytes are missing", async () => {
    await seedCompleteProduction({
      productionId: missingStorage,
      storeFinalVideo: false,
    });

    const { qa: qaService } = await qaServices();
    const outcome = await qaService.runReport(missingStorage, NOW);
    if (outcome === "PRODUCTION_NOT_FOUND") {
      throw new Error("Expected the seeded production to be found");
    }
    const download = outcome.report.checks.find(
      (check) => check.key === "download-readiness",
    );
    expect(download!.status).toBe("FAIL");
    expect(download!.severity).toBe("CRITICAL");
    expect(outcome.report.overallStatus).toBe("FAIL");
  });

  it("returns PRODUCTION_NOT_FOUND from the service and both routes", async () => {
    const { qa: qaService } = await qaServices();
    expect(await qaService.runReport("prod-qa-unknown", NOW)).toBe(
      "PRODUCTION_NOT_FOUND",
    );

    const { POST, GET } = await qaRoute();
    const postResponse = await POST(
      new Request("http://localhost/api/productions/x", { method: "POST" }),
      { params: Promise.resolve({ id: "prod-qa-unknown" }) } as never,
    );
    expect(postResponse.status).toBe(404);
    expect(
      ((await postResponse.json()) as { error: { code: string } }).error.code,
    ).toBe("PRODUCTION_NOT_FOUND");

    const getResponse = await GET(
      new Request("http://localhost/api/productions/x"),
      { params: Promise.resolve({ id: "prod-qa-unknown" }) } as never,
    );
    expect(getResponse.status).toBe(404);
  });

  it("returns an empty history for a production that was never reported", async () => {
    await seedCompleteProduction({
      productionId: unreported,
      storeFinalVideo: true,
    });

    const { GET } = await qaRoute();
    const response = await GET(
      new Request("http://localhost/api/productions/x"),
      { params: Promise.resolve({ id: unreported }) } as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reports: [] });
  });
});
