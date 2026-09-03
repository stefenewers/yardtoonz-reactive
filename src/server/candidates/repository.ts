import { asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";

import { scoreCandidate } from "@/domain/scoring";
import type { CandidateIntakeRecord } from "@/shared/candidate-intake";
import {
  candidateSchema,
  candidateScoresSchema,
  engagementMetricsSchema,
  fitChecklistSchema,
  type Candidate,
  type RightsConfirmation,
} from "@/shared/candidates";

import {
  candidateComments,
  candidates,
  editorialDecisions,
  rightsConfirmations,
} from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type CandidateRow = typeof candidates.$inferSelect;
/** Records reach persistence only after intake assigned every id. */
type PersistableCandidateRecord = CandidateIntakeRecord & { id: string };
type CandidateTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

function parseCandidate(
  row: CandidateRow,
  commentExcerpts: readonly string[],
): Candidate {
  return candidateSchema.parse({
    id: row.id,
    platform: row.platform,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceLabel: row.sourceLabel,
    caption: row.caption,
    publishedAt: row.publishedAt ?? undefined,
    observedAt: row.observedAt,
    metrics: engagementMetricsSchema.parse(JSON.parse(row.metricsJson)),
    commentExcerpts,
    adaptationNote: row.adaptationNote ?? undefined,
    scores: candidateScoresSchema.parse(JSON.parse(row.scoresJson)),
    status: row.status,
    decisionReason: row.decisionReason ?? undefined,
    decidedAt: row.decidedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function serializeCandidateRecord(
  record: PersistableCandidateRecord,
  now: string,
) {
  const scores = scoreCandidate(record);
  return {
    id: record.id,
    platform: record.platform,
    sourceUrl: record.sourceUrl,
    sourceLabel: record.sourceLabel,
    caption: record.caption,
    publishedAt: record.publishedAt,
    observedAt: record.observedAt,
    metricsJson: JSON.stringify(record.metrics),
    adaptationNote: record.adaptationNote,
    fitChecklistJson: JSON.stringify(
      fitChecklistSchema.parse(record.fitChecklist),
    ),
    scoresJson: JSON.stringify(scores),
    status: "NEW" as const,
    createdAt: now,
    updatedAt: now,
  };
}

function insertCandidateRecords(
  database: CandidateTransaction,
  records: readonly PersistableCandidateRecord[],
  now: string,
): number {
  for (const record of records) {
    database
      .insert(candidates)
      .values(serializeCandidateRecord(record, now))
      .run();
    if (record.commentExcerpts.length > 0) {
      database
        .insert(candidateComments)
        .values(
          record.commentExcerpts.map((excerpt, position) => ({
            candidateId: record.id,
            position,
            excerpt,
          })),
        )
        .run();
    }
  }
  return records.length;
}

export function createCandidateRepository(database: Database) {
  function getCandidate(id: string): Candidate | undefined {
    const row = database
      .select()
      .from(candidates)
      .where(eq(candidates.id, id))
      .get();
    if (!row) return undefined;

    const comments = database
      .select({ excerpt: candidateComments.excerpt })
      .from(candidateComments)
      .where(eq(candidateComments.candidateId, id))
      .orderBy(asc(candidateComments.position))
      .all()
      .map(({ excerpt }) => excerpt);

    return parseCandidate(row, comments);
  }

  return {
    seed(records: readonly PersistableCandidateRecord[], now: string): number {
      return database.transaction((transaction) => {
        const existing = transaction
          .select({ id: candidates.id })
          .from(candidates)
          .get();
        if (existing) return 0;

        return insertCandidateRecords(transaction, records, now);
      });
    },

    importIntake(
      records: readonly PersistableCandidateRecord[],
      now: string,
    ): number {
      return database.transaction((transaction) =>
        insertCandidateRecords(transaction, records, now),
      );
    },

    list(): Candidate[] {
      return database
        .select()
        .from(candidates)
        .orderBy(desc(candidates.scoresJson))
        .all()
        .map((row) => getCandidate(row.id))
        .filter((candidate): candidate is Candidate => candidate !== undefined)
        .sort((left, right) => right.scores.overall - left.scores.overall);
    },

    get: getCandidate,

    approve(id: string, decidedAt: string): Candidate | undefined {
      return database.transaction((transaction) => {
        const existing = transaction
          .select({ id: candidates.id })
          .from(candidates)
          .where(eq(candidates.id, id))
          .get();
        if (!existing) return undefined;

        transaction
          .update(candidates)
          .set({ status: "APPROVED", decidedAt, updatedAt: decidedAt })
          .where(eq(candidates.id, id))
          .run();
        transaction
          .insert(editorialDecisions)
          .values({
            id: `decision_${randomUUID()}`,
            candidateId: id,
            decision: "APPROVED",
            decidedAt,
          })
          .run();
        return getCandidate(id);
      });
    },

    confirmRights(input: {
      candidateId: string;
      confirmedAt: string;
      confirmationTextVersion: string;
    }): RightsConfirmation | "NOT_FOUND" | "NOT_APPROVED" {
      return database.transaction((transaction) => {
        const candidate = transaction
          .select({ status: candidates.status })
          .from(candidates)
          .where(eq(candidates.id, input.candidateId))
          .get();
        if (!candidate) return "NOT_FOUND";
        if (candidate.status !== "APPROVED") return "NOT_APPROVED";

        transaction
          .insert(rightsConfirmations)
          .values({
            id: `rights_${randomUUID()}`,
            candidateId: input.candidateId,
            confirmedAt: input.confirmedAt,
            confirmationTextVersion: input.confirmationTextVersion,
          })
          .onConflictDoUpdate({
            target: rightsConfirmations.candidateId,
            set: {
              confirmedAt: input.confirmedAt,
              confirmationTextVersion: input.confirmationTextVersion,
            },
          })
          .run();

        return {
          candidateId: input.candidateId,
          confirmed: true,
          confirmedAt: input.confirmedAt,
          confirmationTextVersion: input.confirmationTextVersion,
        };
      });
    },
  };
}

export type CandidateRepository = ReturnType<typeof createCandidateRepository>;
