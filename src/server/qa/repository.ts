import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { QaReportDraft } from "@/domain/qa-report";
import {
  qaCheckResultSchema,
  qaReportViewSchema,
  type QaReportView,
} from "@/shared/qa-reports";

import { qaReports } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type QaReportRow = typeof qaReports.$inferSelect;

function toView(row: QaReportRow): QaReportView {
  return qaReportViewSchema.parse({
    id: row.id,
    productionId: row.productionId,
    candidateId: row.candidateId,
    runnerVersion: row.runnerVersion,
    overallStatus: row.overallStatus,
    score: row.score,
    // Reads fail loudly on tampered checks: stored reports are re-validated
    // against the public contract, never trusted blindly.
    checks: qaCheckResultSchema.array().parse(JSON.parse(row.checksJson)),
    createdAt: new Date(row.createdAt).toISOString(),
  });
}

export interface NewQaReportInput {
  readonly productionId: string;
  readonly candidateId: string;
  readonly draft: QaReportDraft;
  readonly now: Date;
}

export function createQaReportRepository(database: Database) {
  /**
   * Persist one inspection run. Callers pass their transaction (or the
   * database outside one) so the report joins the writer's existing commit
   * alongside its agent-trace row.
   */
  function insertReport(
    executor: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: NewQaReportInput,
  ): QaReportView {
    const inserted = executor
      .insert(qaReports)
      .values({
        id: `qa_${randomUUID()}`,
        productionId: input.productionId,
        candidateId: input.candidateId,
        runnerVersion: input.draft.runnerVersion,
        overallStatus: input.draft.overallStatus,
        score: input.draft.score,
        checksJson: JSON.stringify(input.draft.checks),
        createdAt: input.now,
      })
      .returning()
      .get();

    return toView(inserted);
  }

  /** Newest first: the latest inspection is the current QA verdict. */
  function listReportsByProduction(productionId: string): QaReportView[] {
    return database
      .select()
      .from(qaReports)
      .where(eq(qaReports.productionId, productionId))
      .orderBy(desc(qaReports.createdAt), desc(qaReports.id))
      .all()
      .map(toView);
  }

  return { insertReport, listReportsByProduction };
}

export type QaReportRepository = ReturnType<typeof createQaReportRepository>;
