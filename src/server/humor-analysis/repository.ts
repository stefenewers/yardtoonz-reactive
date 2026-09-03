import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import {
  commentCorpusAnalysisSchema,
  humorAnalysisResourceSchema,
} from "@/domain/humor-analysis";
import type { HumorAnalysisResource } from "@/domain/humor-analysis";

import { commentAnalyses } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type CommentAnalysisRow = typeof commentAnalyses.$inferSelect;

function parseAnalysisResource(row: CommentAnalysisRow): HumorAnalysisResource {
  // Reads fail loudly on a tampered analysis: the persisted JSON must
  // satisfy the shared evidence contract or the panel must not show it.
  return humorAnalysisResourceSchema.parse({
    id: row.id,
    candidateId: row.candidateId,
    corpusSource: row.corpusSource,
    createdAt: new Date(row.createdAt).toISOString(),
    analysis: commentCorpusAnalysisSchema.parse(JSON.parse(row.analysisJson)),
  });
}

export function createHumorAnalysisRepository(database: Database) {
  function getAnalysis(id: string): HumorAnalysisResource | undefined {
    const row = database
      .select()
      .from(commentAnalyses)
      .where(eq(commentAnalyses.id, id))
      .get();
    return row ? parseAnalysisResource(row) : undefined;
  }

  function getAnalysisForCandidate(
    candidateId: string,
  ): HumorAnalysisResource | undefined {
    const row = database
      .select()
      .from(commentAnalyses)
      .where(eq(commentAnalyses.candidateId, candidateId))
      .get();
    return row ? parseAnalysisResource(row) : undefined;
  }

  /**
   * Refresh-in-place against the unique candidate index: the analyst
   * always reports the latest evidence read, so a re-analysis replaces
   * the row instead of accumulating history.
   */
  function upsertAnalysis(input: {
    id: string;
    candidateId: string;
    corpusSource: (typeof commentAnalyses.$inferInsert)["corpusSource"];
    analysis: unknown;
    now: Date;
  }): HumorAnalysisResource {
    return database.transaction((transaction) => {
      transaction
        .insert(commentAnalyses)
        .values({
          id: input.id,
          candidateId: input.candidateId,
          corpusSource: input.corpusSource,
          analysisJson: JSON.stringify(input.analysis),
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: commentAnalyses.candidateId,
          set: {
            corpusSource: input.corpusSource,
            analysisJson: JSON.stringify(input.analysis),
            updatedAt: input.now,
          },
        })
        .run();

      const row = transaction
        .select()
        .from(commentAnalyses)
        .where(eq(commentAnalyses.candidateId, input.candidateId))
        .get();
      if (!row) {
        throw new Error("Analysis upsert resolved to no persisted row");
      }
      return parseAnalysisResource(row);
    });
  }

  return { getAnalysis, getAnalysisForCandidate, upsertAnalysis };
}

export type HumorAnalysisRepository = ReturnType<
  typeof createHumorAnalysisRepository
>;
