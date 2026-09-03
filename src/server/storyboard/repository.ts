import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { StoryboardPlan } from "@/domain/storyboard";
import {
  buildCueSheet,
  storyboardPlanSchema,
  storyboardResourceSchema,
  type StoryboardResource,
} from "@/domain/storyboard";

import { storyboards } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type StoryboardRow = typeof storyboards.$inferSelect;

function parseStoryboardResource(row: StoryboardRow): StoryboardResource {
  // Reads fail loudly on a tampered plan: the cue sheet is recomputed
  // from the persisted frames, never trusted from storage.
  const plan = storyboardPlanSchema.parse(JSON.parse(row.planJson));
  const outcome = buildCueSheet(plan);
  if (!outcome.ok) {
    throw new Error(
      `Persisted storyboard ${row.id} violates cue-sheet constraints: ${outcome.problems
        .map((problem) => problem.code)
        .join(", ")}`,
    );
  }
  return storyboardResourceSchema.parse({
    id: row.id,
    candidateId: row.candidateId,
    provider: row.provider,
    treatmentId: row.treatmentId,
    createdAt: new Date(row.createdAt).toISOString(),
    plan,
    cueSheet: outcome.cueSheet,
  });
}

export function createStoryboardRepository(database: Database) {
  function getStoryboard(id: string): StoryboardResource | undefined {
    const row = database
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, id))
      .get();
    return row ? parseStoryboardResource(row) : undefined;
  }

  function getStoryboardForCandidate(
    candidateId: string,
  ): StoryboardResource | undefined {
    const row = database
      .select()
      .from(storyboards)
      .where(eq(storyboards.candidateId, candidateId))
      .get();
    return row ? parseStoryboardResource(row) : undefined;
  }

  /**
   * Create-or-get against the unique candidate index: a concurrent or
   * repeated build resolves to the same persisted row, so the demo's
   * storyboard is stable across refreshes.
   */
  function createStoryboard(input: {
    id: string;
    candidateId: string;
    provider: "MOCK";
    treatmentId: string;
    plan: StoryboardPlan;
    now: Date;
  }): StoryboardResource {
    return database.transaction((transaction) => {
      transaction
        .insert(storyboards)
        .values({
          id: input.id,
          candidateId: input.candidateId,
          provider: input.provider,
          treatmentId: input.treatmentId,
          planJson: JSON.stringify(input.plan),
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: storyboards.candidateId })
        .run();

      const row = transaction
        .select()
        .from(storyboards)
        .where(eq(storyboards.candidateId, input.candidateId))
        .get();
      if (!row) {
        throw new Error("Storyboard insert resolved to no persisted row");
      }
      return parseStoryboardResource(row);
    });
  }

  return { getStoryboard, getStoryboardForCandidate, createStoryboard };
}

export type StoryboardRepository = ReturnType<
  typeof createStoryboardRepository
>;
