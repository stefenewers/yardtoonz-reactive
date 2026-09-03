import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";

import { scoreCandidate } from "@/domain/scoring";
import { humorAnalystEvidence, trendScoutEvidence } from "@/domain/agent-trace";
import { insertAgentRun } from "../agents/trace";
import type { CandidateIntakeRecord } from "@/shared/candidate-intake";
import {
  candidateSchema,
  candidateScoresSchema,
  engagementMetricsSchema,
  fitChecklistSchema,
  type Candidate,
  type CandidateListQuery,
  type CandidateScores,
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
  scores: CandidateScores,
  now: string,
) {
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
    const scores = scoreCandidate(record);
    database
      .insert(candidates)
      .values(serializeCandidateRecord(record, scores, now))
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

    // Intake trace: Trend Scout and Humor Analyst score the same record in
    // one transaction, so their rows exist exactly when the candidate does.
    // Their explanations are the honest decisions; deterministic scoring
    // reports no provider, model, or measured elapsed time.
    insertAgentRun(database, {
      agentKey: "trend-scout",
      state: "COMPLETE",
      inputEvidence: trendScoutEvidence({
        platform: record.platform,
        suppliedMetricCount: scores.viralMomentum.inputsUsed.length,
        publishedAtSupplied: record.publishedAt !== undefined,
      }),
      decision: scores.viralMomentum.explanation,
      candidateId: record.id,
      now: new Date(now),
    });
    insertAgentRun(database, {
      agentKey: "humor-analyst",
      state: "COMPLETE",
      inputEvidence: humorAnalystEvidence({
        commentCount: record.commentExcerpts.length,
      }),
      decision: scores.humorResponse.explanation,
      candidateId: record.id,
      now: new Date(now),
    });
  }
  return records.length;
}

/**
 * Apply one editorial decision in the current transaction. Repeating the
 * candidate's current decision is an idempotent no-op that never inserts a
 * second editorial_decisions row.
 */
function recordDecision(
  transaction: CandidateTransaction,
  input: {
    id: string;
    decision: "APPROVED" | "REJECTED";
    decidedAt: string;
    reason?: string;
  },
): boolean {
  const current = transaction
    .select({ status: candidates.status })
    .from(candidates)
    .where(eq(candidates.id, input.id))
    .get();
  if (!current) return false;
  if (current.status === input.decision) return true;

  transaction
    .update(candidates)
    .set({
      status: input.decision,
      decisionReason: input.reason ?? null,
      decidedAt: input.decidedAt,
      updatedAt: input.decidedAt,
    })
    .where(eq(candidates.id, input.id))
    .run();
  transaction
    .insert(editorialDecisions)
    .values({
      id: `decision_${randomUUID()}`,
      candidateId: input.id,
      decision: input.decision,
      reason: input.decision === "REJECTED" ? (input.reason ?? null) : null,
      decidedAt: input.decidedAt,
    })
    .run();
  return true;
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

    list(options: CandidateListQuery = {}): Candidate[] {
      const filters = [
        options.status ? eq(candidates.status, options.status) : undefined,
        options.platform
          ? eq(candidates.platform, options.platform)
          : undefined,
      ].filter((condition) => condition !== undefined);

      const rows = database
        .select()
        .from(candidates)
        .where(filters.length > 0 ? and(...filters) : undefined)
        // Deterministic base order; the score sort below stays stable on ties.
        .orderBy(asc(candidates.createdAt), asc(candidates.id))
        .all();

      const sort = options.sort ?? "overall";
      const direction = options.order === "asc" ? 1 : -1;
      const scoreOf = (candidate: Candidate): number =>
        sort === "overall"
          ? candidate.scores.overall
          : candidate.scores[sort].score;

      return rows
        .map((row) => getCandidate(row.id))
        .filter((candidate): candidate is Candidate => candidate !== undefined)
        .sort((left, right) => direction * (scoreOf(left) - scoreOf(right)));
    },

    get: getCandidate,

    approve(id: string, decidedAt: string): Candidate | undefined {
      return database.transaction((transaction) => {
        const decided = recordDecision(transaction, {
          id,
          decision: "APPROVED",
          decidedAt,
        });
        return decided ? getCandidate(id) : undefined;
      });
    },

    reject(
      id: string,
      decidedAt: string,
      reason?: string,
    ): Candidate | undefined {
      return database.transaction((transaction) => {
        const decided = recordDecision(transaction, {
          id,
          decision: "REJECTED",
          decidedAt,
          reason,
        });
        return decided ? getCandidate(id) : undefined;
      });
    },

    restore(
      id: string,
      decidedAt: string,
    ): Candidate | "NOT_FOUND" | "INVALID_TRANSITION" {
      return database.transaction((transaction) => {
        const current = transaction
          .select({ status: candidates.status })
          .from(candidates)
          .where(eq(candidates.id, id))
          .get();
        if (!current) return "NOT_FOUND";
        // Restore is the rejected state's undo; an approved candidate keeps
        // its approval because productions may already depend on it.
        if (current.status === "APPROVED") return "INVALID_TRANSITION";
        if (current.status === "REJECTED") {
          transaction
            .update(candidates)
            .set({
              status: "NEW",
              decisionReason: null,
              decidedAt: null,
              updatedAt: decidedAt,
            })
            .where(eq(candidates.id, id))
            .run();
        }
        return getCandidate(id) ?? "NOT_FOUND";
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
