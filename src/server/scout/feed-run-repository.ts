import { desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type {
  FeedRunResource,
  TrendFeedSourceKind,
} from "@/shared/trend-scout";
import {
  feedRunResourceSchema,
  trendFeedSourceKindSchema,
} from "@/shared/trend-scout";

import { feedRuns } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type FeedRunRow = typeof feedRuns.$inferSelect;

export interface FeedRunRepository {
  /** Persist a finished run. The id is unique; rows are never updated. */
  create(input: {
    run: FeedRunResource;
    sourceKind: TrendFeedSourceKind;
  }): void;
  /** Every run, newest first. */
  list(): FeedRunResource[];
  /** The most recent run, or undefined before the first scout run. */
  latest(): FeedRunResource | undefined;
}

/**
 * Rebuild the validated resource from the row. Persistence round-trips
 * through the same Zod contract the API serves, so a drifted row fails
 * loudly instead of leaking malformed state into the inbox header.
 */
function parseRun(row: FeedRunRow): FeedRunResource {
  return feedRunResourceSchema.parse({
    id: row.id,
    themes: JSON.parse(row.themesJson),
    status: row.status,
    discoveredCount: row.discoveredCount,
    duplicateCount: row.duplicateCount,
    importedCount: row.importedCount,
    importedCandidateIds: JSON.parse(row.importedCandidateIdsJson),
    errorCode: row.errorCode ?? undefined,
    safeErrorMessage: row.safeErrorMessage ?? undefined,
    startedAt: new Date(row.startedAt).toISOString(),
    completedAt: new Date(row.completedAt).toISOString(),
  });
}

export function createFeedRunRepository(database: Database): FeedRunRepository {
  return {
    create({ run, sourceKind }) {
      // sourceKind is an audit-trail column for future provider kinds; the
      // served resource omits it.
      database.insert(feedRuns).values({
        id: run.id,
        themesJson: JSON.stringify(run.themes),
        status: run.status,
        sourceKind,
        discoveredCount: run.discoveredCount,
        duplicateCount: run.duplicateCount,
        importedCount: run.importedCount,
        importedCandidateIdsJson: JSON.stringify(run.importedCandidateIds),
        errorCode: run.errorCode ?? null,
        safeErrorMessage: run.safeErrorMessage ?? null,
        startedAt: new Date(run.startedAt),
        completedAt: new Date(run.completedAt),
      });
    },

    list() {
      const rows = database
        .select()
        .from(feedRuns)
        .orderBy(desc(feedRuns.completedAt), desc(feedRuns.id))
        .all();
      return rows.map((row) => {
        // Rows written outside the application could carry an unknown kind;
        // validate so a drifted column fails loudly.
        trendFeedSourceKindSchema.parse(row.sourceKind);
        return parseRun(row);
      });
    },

    latest() {
      return this.list()[0];
    },
  };
}
