import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { candidateFixtures } from "../../fixtures/candidates";
import { createCandidateRepository } from "../../src/server/candidates/repository";
import { createProductionRepository } from "../../src/server/productions/repository";
import { productionErrorResult } from "../../src/server/productions/errors";
import * as schema from "../../src/server/db/schema";

const openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

function createRepositories() {
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  return {
    candidates: createCandidateRepository(database),
    productions: createProductionRepository(database),
  };
}

/** Approves the first fixture candidate and confirms its rights row. */
function prepareApprovedCandidate(
  candidates: ReturnType<typeof createCandidateRepository>,
): string {
  candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
  const candidateId = candidateFixtures[0]!.id;
  candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
  candidates.confirmRights({
    candidateId,
    confirmedAt: "2026-09-03T12:02:00.000Z",
    confirmationTextVersion: "rights-v1",
  });
  return candidateId;
}

const segment = {
  startSeconds: 1,
  endSeconds: 7,
  durationSeconds: 6,
};

const now = new Date("2026-09-03T12:03:00.000Z");

describe("production repository gates", () => {
  it("requires an approved candidate before creating a draft", () => {
    const { candidates, productions } = createRepositories();
    candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
    const pendingId = candidateFixtures[0]!.id;

    expect(() =>
      productions.createDraft({
        candidateId: pendingId,
        segment,
        imageProvider: "MOCK",
        animationProvider: "MOCK",
        now,
      }),
    ).toThrowError();
    expect(
      productionErrorResult(
        (() => {
          try {
            productions.createDraft({
              candidateId: pendingId,
              segment,
              imageProvider: "MOCK",
              animationProvider: "MOCK",
              now,
            });
          } catch (error) {
            return error;
          }
        })(),
      )?.code,
    ).toBe("CANDIDATE_NOT_APPROVED");

    const approvedId = prepareApprovedCandidate(candidates);
    expect(
      productions.createDraft({
        candidateId: approvedId,
        segment,
        imageProvider: "MOCK",
        animationProvider: "MOCK",
        now,
      }),
    ).toMatch(/^prod_/);
    expect(() =>
      productions.createDraft({
        candidateId: "candidate-does-not-exist",
        segment,
        imageProvider: "MOCK",
        animationProvider: "MOCK",
        now,
      }),
    ).toThrowError();
  });

  it("rejects start before persisted rights are confirmed", () => {
    const { candidates, productions } = createRepositories();
    candidates.seed(candidateFixtures, "2026-09-03T12:00:00.000Z");
    const candidateId = candidateFixtures[0]!.id;
    candidates.approve(candidateId, "2026-09-03T12:01:00.000Z");
    const id = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });

    const started = (() => {
      try {
        productions.start(id, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error)?.code;
      }
    })();
    expect(started).toBe("RIGHTS_REQUIRED");
  });

  it("queues an approved production and seeds the pipeline stages", () => {
    const { candidates, productions } = createRepositories();
    const candidateId = prepareApprovedCandidate(candidates);
    const id = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });
    productions.recordSourceUpload(
      id,
      {
        storageKey: `${id}/source.mp4`,
        mimeType: "video/mp4",
        byteSize: 1024,
        sha256: "a".repeat(64),
        metadata: { durationSeconds: 10, audioPresent: true },
      },
      now,
    );

    productions.confirmRights(id, now);

    const queued = productions.start(id, now);
    expect(queued.production.status).toBe("QUEUED");
    expect(
      queued.stages.filter((stage) => stage.name === "INGEST_SOURCE"),
    ).toHaveLength(1);
    expect(
      queued.stages.filter((stage) => stage.name === "EXTRACT_MEDIA"),
    ).toHaveLength(1);

    const detail = productions.getDetail(id);
    expect(detail?.production.status).toBe("QUEUED");
    expect(detail?.production.segment).toEqual(segment);
    expect(detail?.production.imageProvider).toBe("MOCK");
    expect(detail?.production.animationProvider).toBe("MOCK");
  });

  it("enforces one active job per candidate atomically", () => {
    const { candidates, productions } = createRepositories();
    const candidateId = prepareApprovedCandidate(candidates);
    const first = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });
    const second = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });
    for (const id of [first, second]) {
      productions.recordSourceUpload(
        id,
        {
          storageKey: `${id}/source.mp4`,
          mimeType: "video/mp4",
          byteSize: 1024,
          sha256: "b".repeat(64),
          metadata: { durationSeconds: 10, audioPresent: true },
        },
        now,
      );
      productions.confirmRights(id, now);
    }

    expect(productions.start(first, now).production.status).toBe("QUEUED");

    const secondStart = (() => {
      try {
        productions.start(second, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error);
      }
    })();
    expect((secondStart as { code?: string } | undefined)?.code).toBe(
      "PRODUCTION_ALREADY_ACTIVE",
    );
  });

  it("answers re-start attempts on a queued job with a stable transition error", () => {
    const { candidates, productions } = createRepositories();
    const candidateId = prepareApprovedCandidate(candidates);
    const id = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });
    productions.recordSourceUpload(
      id,
      {
        storageKey: `${id}/source.mp4`,
        mimeType: "video/mp4",
        byteSize: 1024,
        sha256: "c".repeat(64),
        metadata: { durationSeconds: 10, audioPresent: true },
      },
      now,
    );
    productions.confirmRights(id, now);
    productions.start(id, now);

    const restart = (() => {
      try {
        productions.start(id, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error);
      }
    })();
    expect((restart as { code?: string } | undefined)?.code).toBe(
      "ILLEGAL_TRANSITION",
    );
  });

  it("gates start on the probed source matching the selected segment", () => {
    const { candidates, productions } = createRepositories();
    const candidateId = prepareApprovedCandidate(candidates);
    const id = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });
    productions.confirmRights(id, now);

    const noSource = (() => {
      try {
        productions.start(id, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error)?.code;
      }
    })();
    expect(noSource).toBe("SOURCE_REQUIRED");

    productions.recordSourceUpload(
      id,
      {
        storageKey: `${id}/source.mp4`,
        mimeType: "video/mp4",
        byteSize: 1024,
        sha256: "d".repeat(64),
        metadata: { durationSeconds: 10, audioPresent: false },
      },
      now,
    );
    const silent = (() => {
      try {
        productions.start(id, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error)?.code;
      }
    })();
    expect(silent).toBe("SOURCE_AUDIO_REQUIRED");

    productions.recordSourceUpload(
      id,
      {
        storageKey: `${id}/source.mp4`,
        mimeType: "video/mp4",
        byteSize: 1024,
        sha256: "e".repeat(64),
        metadata: { durationSeconds: 2, audioPresent: true },
      },
      now,
    );
    const short = (() => {
      try {
        productions.start(id, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error)?.code;
      }
    })();
    expect(short).toBe("SOURCE_TOO_SHORT");
  });

  it("keeps queued jobs immutable from setup edits", () => {
    const { candidates, productions } = createRepositories();
    const candidateId = prepareApprovedCandidate(candidates);
    const id = productions.createDraft({
      candidateId,
      segment,
      imageProvider: "MOCK",
      animationProvider: "MOCK",
      now,
    });
    productions.recordSourceUpload(
      id,
      {
        storageKey: `${id}/source.mp4`,
        mimeType: "video/mp4",
        byteSize: 1024,
        sha256: "f".repeat(64),
        metadata: { durationSeconds: 10, audioPresent: true },
      },
      now,
    );
    productions.confirmRights(id, now);
    productions.start(id, now);

    const edit = (() => {
      try {
        productions.updateSetup(id, { creativeDirection: "more clay" }, now);
        return "no-error";
      } catch (error) {
        return productionErrorResult(error)?.code;
      }
    })();
    expect(edit).toBe("ILLEGAL_TRANSITION");
  });
});
