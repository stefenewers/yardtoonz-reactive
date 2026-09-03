import { asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";

import { scoreCandidate } from "@/domain/scoring";
import type { CandidateFixture } from "@/../fixtures/candidates";
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

function serializeFixture(fixture: CandidateFixture, now: string) {
  const scores = scoreCandidate(fixture);
  return {
    id: fixture.id,
    platform: fixture.platform,
    sourceUrl: fixture.sourceUrl,
    sourceLabel: fixture.sourceLabel,
    caption: fixture.caption,
    publishedAt: fixture.publishedAt,
    observedAt: fixture.observedAt,
    metricsJson: JSON.stringify(fixture.metrics),
    adaptationNote: fixture.adaptationNote,
    fitChecklistJson: JSON.stringify(
      fitChecklistSchema.parse(fixture.fitChecklist),
    ),
    scoresJson: JSON.stringify(scores),
    status: "NEW" as const,
    createdAt: now,
    updatedAt: now,
  };
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
    seed(fixtures: readonly CandidateFixture[], now: string): number {
      return database.transaction((transaction) => {
        const existing = transaction
          .select({ id: candidates.id })
          .from(candidates)
          .get();
        if (existing) return 0;

        for (const fixture of fixtures) {
          transaction
            .insert(candidates)
            .values(serializeFixture(fixture, now))
            .run();
          if (fixture.commentExcerpts.length > 0) {
            transaction
              .insert(candidateComments)
              .values(
                fixture.commentExcerpts.map((excerpt, position) => ({
                  candidateId: fixture.id,
                  position,
                  excerpt,
                })),
              )
              .run();
          }
        }
        return fixtures.length;
      });
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
