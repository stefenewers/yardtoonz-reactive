import "server-only";

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { directorTreatmentSchema } from "@/domain/director";
import { runQaReport, type QaArtifactFact } from "@/domain/qa-report";
import type { ArtifactStore } from "@/lib/artifact-store";
import { ArtifactStoreError } from "@/lib/artifact-store";
import { env } from "@/lib/env";
import { insertAgentRun } from "@/server/agents/trace";
import { createDatabaseProvider } from "@/server/db/client";
import {
  artifacts,
  candidates,
  directorTreatments,
  productions,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { getProductionArtifactStore } from "@/server/productions/service";
import type { QaReportView } from "@/shared/qa-reports";

import {
  createQaReportRepository,
  type QaReportRepository,
} from "./repository";

type Database = BetterSQLite3Database<typeof schema>;

export type QaReportRunOutcome =
  | { readonly report: QaReportView }
  | "PRODUCTION_NOT_FOUND";

export type QaReportListOutcome =
  | { readonly reports: readonly QaReportView[] }
  | "PRODUCTION_NOT_FOUND";

export function createQaReportService(
  database: Database,
  store: ArtifactStore,
): {
  runReport: (productionId: string, now: Date) => Promise<QaReportRunOutcome>;
  listReports: (productionId: string) => QaReportListOutcome;
} {
  const repository: QaReportRepository = createQaReportRepository(database);

  async function storagePresent(storageKey: string): Promise<boolean> {
    try {
      await store.inspect(storageKey);
      return true;
    } catch (error) {
      if (
        error instanceof ArtifactStoreError &&
        error.code === "ARTIFACT_NOT_FOUND"
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Inspect one production: reduce its persisted rows to plain facts, run
   * the deterministic checks registry, and persist the report together with
   * the QA Inspector's trace row in one transaction. The report is an
   * observation — repeats append history, never overwrite.
   */
  async function runReport(
    productionId: string,
    now: Date,
  ): Promise<QaReportRunOutcome> {
    const productionRow = database
      .select()
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!productionRow) return "PRODUCTION_NOT_FOUND";

    const candidateRow = database
      .select({ id: candidates.id, caption: candidates.caption })
      .from(candidates)
      .where(eq(candidates.id, productionRow.candidateId))
      .get();
    if (!candidateRow) return "PRODUCTION_NOT_FOUND";

    const artifactRows = database
      .select()
      .from(artifacts)
      .where(eq(artifacts.productionId, productionId))
      .all();

    const treatmentRow = database
      .select({ treatmentJson: directorTreatments.treatmentJson })
      .from(directorTreatments)
      .where(eq(directorTreatments.candidateId, productionRow.candidateId))
      .get();
    // Reads fail loudly on a tampered treatment; a missing treatment is a
    // normal evidence gap the caption check reports.
    const socialCaption = treatmentRow
      ? directorTreatmentSchema.parse(JSON.parse(treatmentRow.treatmentJson))
          .socialCaption
      : null;

    const artifactFacts: QaArtifactFact[] = await Promise.all(
      artifactRows.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        provider: row.provider,
        providerRequestId: row.providerRequestId,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        sha256: row.sha256,
        parentArtifactIds: JSON.parse(row.parentArtifactIdsJson) as string[],
        storagePresent: await storagePresent(row.storageKey),
        metadata: JSON.parse(row.metadataJson) as QaArtifactFact["metadata"],
      })),
    );

    const startedAtMs = Date.now();
    const draft = runQaReport({
      production: {
        id: productionRow.id,
        candidateId: productionRow.candidateId,
        status: productionRow.status,
        imageProvider: productionRow.imageProvider,
        animationProvider: productionRow.animationProvider,
        segmentDurationMs: productionRow.segmentDurationMs,
      },
      artifacts: artifactFacts,
      captions: {
        caption: candidateRow.caption,
        socialCaption,
      },
    });
    const elapsedMs = Date.now() - startedAtMs;

    const failedCount = draft.checks.filter(
      (check) => check.status === "FAIL",
    ).length;
    const warnedCount = draft.checks.filter(
      (check) => check.status === "WARN",
    ).length;
    const finalVideo = artifactFacts.find(
      (artifact) => artifact.kind === "FINAL_VIDEO",
    );

    const report = database.transaction((transaction) => {
      const inserted = repository.insertReport(transaction, {
        productionId: productionRow.id,
        candidateId: productionRow.candidateId,
        draft,
        now,
      });

      // The QA Inspector's trace row exists exactly when the report does:
      // one persisted observation of the production's output quality.
      insertAgentRun(transaction, {
        agentKey: "qa-inspector",
        state: "COMPLETE",
        inputEvidence: {
          artifactCount: artifactFacts.length,
          finalVideoPresent: finalVideo !== undefined,
          failedChecks: failedCount,
          warnedChecks: warnedCount,
          overallStatus: draft.overallStatus,
          score: draft.score,
        },
        decision: `QA report ${draft.overallStatus} at ${draft.score}/100 — ${failedCount} failed, ${warnedCount} warned.`,
        elapsedMs,
        artifactIds: finalVideo ? [finalVideo.id] : [],
        candidateId: productionRow.candidateId,
        productionId: productionRow.id,
        now,
      });

      return inserted;
    });

    return { report };
  }

  /** Newest first report history for one production; 404-mapped. */
  function listReports(productionId: string): QaReportListOutcome {
    const exists = database
      .select({ id: productions.id })
      .from(productions)
      .where(eq(productions.id, productionId))
      .get();
    if (!exists) return "PRODUCTION_NOT_FOUND";

    return { reports: repository.listReportsByProduction(productionId) };
  }

  return { runReport, listReports };
}

export type QaReportService = ReturnType<typeof createQaReportService>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the other server singletons.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: QaReportService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getQaReportService(): QaReportService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createQaReportService(
    connection.database,
    getProductionArtifactStore(),
  );
  return service;
}
