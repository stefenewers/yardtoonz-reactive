import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import {
  directorTreatmentResourceSchema,
  directorTreatmentSchema,
  type DirectorTreatment,
  type DirectorTreatmentResource,
} from "@/domain/director";
import type { DirectorProvider } from "@/lib/providers";

import { directorTreatments } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type TreatmentRow = typeof directorTreatments.$inferSelect;

function parseTreatmentResource(row: TreatmentRow): DirectorTreatmentResource {
  return directorTreatmentResourceSchema.parse({
    id: row.id,
    candidateId: row.candidateId,
    provider: row.provider,
    createdAt: new Date(row.createdAt).toISOString(),
    treatment: directorTreatmentSchema.parse(JSON.parse(row.treatmentJson)),
  });
}

export function createDirectorTreatmentRepository(database: Database) {
  function getTreatment(id: string): DirectorTreatmentResource | undefined {
    const row = database
      .select()
      .from(directorTreatments)
      .where(eq(directorTreatments.id, id))
      .get();
    return row ? parseTreatmentResource(row) : undefined;
  }

  function getTreatmentForCandidate(
    candidateId: string,
  ): DirectorTreatmentResource | undefined {
    const row = database
      .select()
      .from(directorTreatments)
      .where(eq(directorTreatments.candidateId, candidateId))
      .orderBy(desc(directorTreatments.createdAt))
      .get();
    return row ? parseTreatmentResource(row) : undefined;
  }

  /**
   * Create-or-get against the unique candidate index: a concurrent or
   * repeated ask resolves to the same persisted row, so the demo's
   * treatment is stable across refreshes.
   */
  function createTreatment(input: {
    id: string;
    candidateId: string;
    provider: DirectorProvider;
    treatment: DirectorTreatment;
    now: Date;
  }): DirectorTreatmentResource {
    return database.transaction((transaction) => {
      transaction
        .insert(directorTreatments)
        .values({
          id: input.id,
          candidateId: input.candidateId,
          provider: input.provider,
          treatmentJson: JSON.stringify(input.treatment),
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: directorTreatments.candidateId })
        .run();

      const row = transaction
        .select()
        .from(directorTreatments)
        .where(eq(directorTreatments.candidateId, input.candidateId))
        .get();
      if (!row) {
        throw new Error(
          "Director treatment insert resolved to no persisted row",
        );
      }
      return parseTreatmentResource(row);
    });
  }

  return { getTreatment, getTreatmentForCandidate, createTreatment };
}

export type DirectorTreatmentRepository = ReturnType<
  typeof createDirectorTreatmentRepository
>;
