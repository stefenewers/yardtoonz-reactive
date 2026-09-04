import "server-only";

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { directorTreatmentSchema } from "@/domain/director";
import type { SourceAttribution } from "@/shared/attribution";

import {
  candidates,
  directorTreatments,
  productions,
  rightsConfirmations,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";

type Database = BetterSQLite3Database<typeof schema>;

/**
 * Read the persisted source attribution for one production: the candidate's
 * origin reference, the Director's generated social caption, and the rights
 * record. Everything is read-only; a missing production yields undefined so
 * the route can answer 404, and a missing treatment or rights row simply
 * reports null instead of guessing.
 */
export function readProductionAttribution(
  database: Database,
  productionId: string,
): SourceAttribution | undefined {
  const productionRow = database
    .select({ candidateId: productions.candidateId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
  if (!productionRow) return undefined;

  const candidateRow = database
    .select({
      id: candidates.id,
      platform: candidates.platform,
      sourceUrl: candidates.sourceUrl,
      sourceLabel: candidates.sourceLabel,
      caption: candidates.caption,
      observedAt: candidates.observedAt,
    })
    .from(candidates)
    .where(eq(candidates.id, productionRow.candidateId))
    .get();
  if (!candidateRow) return undefined;

  const treatmentRow = database
    .select({ treatmentJson: directorTreatments.treatmentJson })
    .from(directorTreatments)
    .where(eq(directorTreatments.candidateId, candidateRow.id))
    .get();
  // A tampered treatment fails loudly; absence is a normal evidence gap the
  // panel reports as "no generated social caption yet".
  const socialCaption = treatmentRow
    ? directorTreatmentSchema.parse(JSON.parse(treatmentRow.treatmentJson))
        .socialCaption
    : null;

  const rightsRow = database
    .select({
      confirmedAt: rightsConfirmations.confirmedAt,
      confirmationTextVersion: rightsConfirmations.confirmationTextVersion,
    })
    .from(rightsConfirmations)
    .where(eq(rightsConfirmations.candidateId, candidateRow.id))
    .get();

  return {
    candidateId: candidateRow.id,
    platform: candidateRow.platform as SourceAttribution["platform"],
    sourceUrl: candidateRow.sourceUrl ?? null,
    sourceLabel: candidateRow.sourceLabel,
    caption: candidateRow.caption,
    observedAt: candidateRow.observedAt,
    socialCaption,
    rightsConfirmation: rightsRow
      ? {
          confirmedAt: rightsRow.confirmedAt,
          confirmationTextVersion: rightsRow.confirmationTextVersion,
        }
      : null,
  };
}
