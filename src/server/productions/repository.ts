import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  transitionProduction,
  ProductionTransitionError,
  type ProductionJob,
  type SegmentSelection,
} from "@/domain/production";
import type { AnimationProvider, ImageProvider } from "@/lib/providers";
import { productionDetailResponseSchema } from "@/shared/productions";
import type { ProductionDetailResponse } from "@/shared/productions";

import { ProductionGateError } from "./errors";
import {
  artifacts,
  candidates,
  editorialDecisions,
  productions,
  productionStages,
  rightsConfirmations,
} from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type ProductionRow = typeof productions.$inferSelect;

/** Statuses in which a production occupies the candidate's single job slot. */
const activeProductionStatuses = [
  "QUEUED",
  "EXTRACTING",
  "STYLING",
  "ANIMATING",
  "MUXING",
  "VALIDATING",
] as const;

const pipelineStageOrder = sql`CASE ${productionStages.name}
  WHEN 'INGEST_SOURCE' THEN 0
  WHEN 'EXTRACT_MEDIA' THEN 1
  WHEN 'SELECT_KEYFRAME' THEN 2
  WHEN 'STYLE_IMAGE' THEN 3
  WHEN 'ANIMATE_IMAGE' THEN 4
  WHEN 'MUX_AND_NORMALIZE' THEN 5
  WHEN 'VALIDATE_OUTPUT' THEN 6
  ELSE 7 END`;

const sourceMetadataSchema = z
  .object({
    durationSeconds: z.number().finite().positive(),
    audioPresent: z.boolean(),
  })
  .passthrough();

const remainingPipelineStages = [
  "EXTRACT_MEDIA",
  "SELECT_KEYFRAME",
  "STYLE_IMAGE",
  "ANIMATE_IMAGE",
  "MUX_AND_NORMALIZE",
  "VALIDATE_OUTPUT",
] as const;

/** Wire segments are seconds; persistence stores whole milliseconds. */
function segmentToMilliseconds(segment: SegmentSelection): {
  startMs: number;
  endMs: number;
  durationMs: number;
} {
  const startMs = Math.round(segment.startSeconds * 1000);
  const endMs = Math.round(segment.endSeconds * 1000);
  return { startMs, endMs, durationMs: endMs - startMs };
}

function segmentFromMilliseconds(row: ProductionRow): SegmentSelection {
  return {
    startSeconds: row.segmentStartMs / 1000,
    endSeconds: row.segmentEndMs / 1000,
    durationSeconds: row.segmentDurationMs / 1000,
  };
}

const stageViewColumns = {
  id: productionStages.id,
  name: productionStages.name,
  status: productionStages.status,
  attempt: productionStages.attempt,
  startedAt: productionStages.startedAt,
  completedAt: productionStages.completedAt,
  errorCode: productionStages.errorCode,
  safeErrorMessage: productionStages.safeErrorMessage,
  workerLeaseOwner: productionStages.workerLeaseOwner,
  providerRequestId: productionStages.providerRequestId,
};

export function createProductionRepository(database: Database) {
  function getProductionRow(id: string): ProductionRow | undefined {
    return database
      .select()
      .from(productions)
      .where(eq(productions.id, id))
      .get();
  }

  function getRightsConfirmation(
    rightsConfirmationId: string,
    candidateId: string,
  ) {
    return database
      .select()
      .from(rightsConfirmations)
      .where(
        and(
          eq(rightsConfirmations.id, rightsConfirmationId),
          eq(rightsConfirmations.candidateId, candidateId),
        ),
      )
      .get();
  }

  function getDetail(id: string): ProductionDetailResponse | undefined {
    const row = getProductionRow(id);
    if (!row) return undefined;

    const stageRows = database
      .select(stageViewColumns)
      .from(productionStages)
      .where(eq(productionStages.productionId, id))
      .orderBy(pipelineStageOrder, asc(productionStages.attempt))
      .all();
    const artifactRows = database
      .select()
      .from(artifacts)
      .where(eq(artifacts.productionId, id))
      .orderBy(asc(artifacts.createdAt))
      .all();
    const outputDecisionRow = getLatestOutputDecisionRow(id);

    return productionDetailResponseSchema.parse({
      production: {
        id: row.id,
        candidateId: row.candidateId,
        status: row.status,
        imageProvider: row.imageProvider,
        animationProvider: row.animationProvider,
        segment: segmentFromMilliseconds(row),
        creativeDirection: row.creativeDirection ?? undefined,
        activeStage: row.activeStage ?? undefined,
        attempt: row.attempt,
        errorCode: row.errorCode ?? undefined,
        safeErrorMessage: row.safeErrorMessage ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        completedAt: row.completedAt?.toISOString(),
      },
      stages: stageRows.map((stage) => ({
        id: stage.id,
        name: stage.name,
        status: stage.status,
        attempt: stage.attempt,
        startedAt: stage.startedAt?.toISOString(),
        completedAt: stage.completedAt?.toISOString(),
        errorCode: stage.errorCode ?? undefined,
        safeErrorMessage: stage.safeErrorMessage ?? undefined,
        workerLeaseOwner: stage.workerLeaseOwner ?? undefined,
        providerRequestId: stage.providerRequestId ?? undefined,
      })),
      artifacts: artifactRows.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        provider: artifact.provider,
        providerRequestId: artifact.providerRequestId ?? undefined,
        mimeType: artifact.mimeType,
        byteSize: artifact.byteSize,
        sha256: artifact.sha256,
        metadata: JSON.parse(artifact.metadataJson) as Record<
          string,
          string | number | boolean | null
        >,
        createdAt: artifact.createdAt.toISOString(),
      })),
      outputDecision: outputDecisionRow
        ? {
            decision: outputDecisionRow.decision,
            reason: outputDecisionRow.reason ?? undefined,
            decidedAt: outputDecisionRow.decidedAt,
          }
        : undefined,
    });
  }

  /** The newest OUTPUT decision for a production, if any. */
  function getLatestOutputDecisionRow(productionId: string) {
    return database
      .select({
        decision: editorialDecisions.decision,
        reason: editorialDecisions.reason,
        decidedAt: editorialDecisions.decidedAt,
      })
      .from(editorialDecisions)
      .where(
        and(
          eq(editorialDecisions.productionId, productionId),
          eq(editorialDecisions.subject, "OUTPUT"),
        ),
      )
      .orderBy(desc(editorialDecisions.decidedAt))
      .get();
  }

  function buildDomainJob(
    row: ProductionRow,
    rights: { confirmedAt: string; confirmationTextVersion: string },
  ): ProductionJob {
    return {
      id: row.id,
      candidateId: row.candidateId,
      status: row.status,
      imageProvider: row.imageProvider,
      animationProvider: row.animationProvider,
      rights: {
        confirmed: true,
        confirmedAt: rights.confirmedAt,
        confirmationTextVersion: rights.confirmationTextVersion,
      },
      artifacts: [],
    };
  }

  /**
   * Read-only diagnostics view of every production, newest first, with its
   * stages (pipeline order) and artifacts (creation order). Cheap snapshot —
   * no output decisions, bytes, or secret material.
   */
  function listAll(): ProductionDetailResponse[] {
    return database
      .select()
      .from(productions)
      .orderBy(desc(productions.createdAt))
      .all()
      .map((row) => {
        const detail = getDetail(row.id);
        if (detail) return detail;

        // A production row always carries its immutable stage set, so an
        // unreadable detail is a schema drift bug — fail closed, loudly.
        throw new Error(`Production ${row.id} failed diagnostics validation`);
      });
  }

  return {
    getDetail,
    listAll,

    /** Resolves one artifact row for safe byte serving; undefined when absent. */
    getArtifact(
      productionId: string,
      artifactId: string,
    ):
      | {
          kind: (typeof artifacts.$inferSelect)["kind"];
          mimeType: string;
          storageKey: string;
          byteSize: number;
        }
      | undefined {
      return database
        .select({
          kind: artifacts.kind,
          mimeType: artifacts.mimeType,
          storageKey: artifacts.storageKey,
          byteSize: artifacts.byteSize,
        })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.productionId, productionId),
            eq(artifacts.id, artifactId),
          ),
        )
        .get();
    },

    /**
     * Persists an OUTPUT editorial decision on a COMPLETE production.
     * Repeating the current decision is an idempotent no-op that never
     * inserts a second row; switching decisions appends a fresh timestamped
     * row so the review history stays auditable.
     */
    recordOutputDecision(
      id: string,
      input: { decision: "APPROVED" | "REJECTED"; reason?: string },
      now: Date,
    ): ProductionDetailResponse {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, id))
          .get();
        if (!row) throw new ProductionGateError("PRODUCTION_NOT_FOUND");
        if (row.status !== "COMPLETE") {
          throw new ProductionTransitionError("ILLEGAL_TRANSITION");
        }

        const latest = getLatestOutputDecisionRow(id);
        if (latest?.decision !== input.decision) {
          transaction
            .insert(editorialDecisions)
            .values({
              id: `decision_${randomUUID()}`,
              candidateId: row.candidateId,
              productionId: id,
              subject: "OUTPUT",
              decision: input.decision,
              reason:
                input.decision === "REJECTED" ? (input.reason ?? null) : null,
              decidedAt: now.toISOString(),
            })
            .run();
        }

        return getDetail(id)!;
      });
    },

    /** All productions for one candidate, newest first (revisit recovery). */
    listForCandidate(candidateId: string): ProductionDetailResponse[] {
      const rows = database
        .select({ id: productions.id })
        .from(productions)
        .where(eq(productions.candidateId, candidateId))
        .orderBy(desc(productions.createdAt))
        .all();
      return rows.flatMap(({ id }) => {
        const detail = getDetail(id);
        return detail ? [detail] : [];
      });
    },

    createDraft(input: {
      candidateId: string;
      segment: SegmentSelection;
      imageProvider: ImageProvider;
      animationProvider: AnimationProvider;
      now: Date;
    }): string {
      return database.transaction((transaction) => {
        const candidate = transaction
          .select({ status: candidates.status })
          .from(candidates)
          .where(eq(candidates.id, input.candidateId))
          .get();
        if (!candidate) {
          throw new ProductionGateError("CANDIDATE_NOT_FOUND");
        }
        if (candidate.status !== "APPROVED") {
          throw new ProductionGateError("CANDIDATE_NOT_APPROVED");
        }

        const segmentMs = segmentToMilliseconds(input.segment);
        const id = `prod_${randomUUID()}`;
        transaction
          .insert(productions)
          .values({
            id,
            candidateId: input.candidateId,
            status: "DRAFT",
            imageProvider: input.imageProvider,
            animationProvider: input.animationProvider,
            segmentStartMs: segmentMs.startMs,
            segmentEndMs: segmentMs.endMs,
            segmentDurationMs: segmentMs.durationMs,
            attempt: 1,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .run();
        return id;
      });
    },

    /**
     * Runs the domain CONFIRM_RIGHTS transition against the candidate's
     * persisted rights confirmation; the production links the rights row so
     * the start gate can verify it atomically.
     */
    confirmRights(id: string, now: Date): ProductionDetailResponse {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, id))
          .get();
        if (!row) throw new ProductionGateError("PRODUCTION_NOT_FOUND");

        const rights = transaction
          .select()
          .from(rightsConfirmations)
          .where(eq(rightsConfirmations.candidateId, row.candidateId))
          .get();
        if (!rights) throw new ProductionGateError("RIGHTS_REQUIRED");

        const job = buildDomainJob(row, {
          confirmedAt: rights.confirmedAt,
          confirmationTextVersion: rights.confirmationTextVersion,
        });
        transitionProduction(job, {
          type: "CONFIRM_RIGHTS",
          rights: {
            confirmed: true,
            confirmedAt: rights.confirmedAt,
            confirmationTextVersion: rights.confirmationTextVersion,
          },
        });

        transaction
          .update(productions)
          .set({
            status: "RIGHTS_CONFIRMED",
            rightsConfirmationId: rights.id,
            updatedAt: now,
          })
          .where(eq(productions.id, id))
          .run();

        return getDetail(id)!;
      });
    },

    /**
     * Saves pre-queue setup attributes. Segment and creative direction are
     * setup state, not status transitions; the pre-queue guard keeps queued
     * and worker-owned jobs immutable from the API.
     */
    updateSetup(
      id: string,
      input: { segment?: SegmentSelection; creativeDirection?: string },
      now: Date,
    ): ProductionDetailResponse {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, id))
          .get();
        if (!row) throw new ProductionGateError("PRODUCTION_NOT_FOUND");
        if (row.status !== "DRAFT" && row.status !== "RIGHTS_CONFIRMED") {
          throw new ProductionTransitionError("ILLEGAL_TRANSITION");
        }

        const segmentMs = input.segment
          ? segmentToMilliseconds(input.segment)
          : undefined;
        transaction
          .update(productions)
          .set({
            segmentStartMs: segmentMs?.startMs ?? row.segmentStartMs,
            segmentEndMs: segmentMs?.endMs ?? row.segmentEndMs,
            segmentDurationMs: segmentMs?.durationMs ?? row.segmentDurationMs,
            creativeDirection: input.creativeDirection ?? row.creativeDirection,
            updatedAt: now,
          })
          .where(eq(productions.id, id))
          .run();

        return getDetail(id)!;
      });
    },

    /**
     * Records the probed source upload: INGEST_SOURCE completes with the
     * source artifact attached. Re-uploads replace the artifact in place so
     * no duplicate rows exist (Technical Specification §7 invariant 6).
     */
    recordSourceUpload(
      id: string,
      input: {
        storageKey: string;
        mimeType: string;
        byteSize: number;
        sha256: string;
        metadata: Record<string, string | number | boolean | null>;
      },
      now: Date,
    ): ProductionDetailResponse {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, id))
          .get();
        if (!row) throw new ProductionGateError("PRODUCTION_NOT_FOUND");
        if (row.status !== "DRAFT" && row.status !== "RIGHTS_CONFIRMED") {
          throw new ProductionTransitionError("ILLEGAL_TRANSITION");
        }

        const stageId = `${id}-INGEST_SOURCE`;
        transaction
          .insert(productionStages)
          .values({
            id: stageId,
            productionId: id,
            name: "INGEST_SOURCE",
            status: "COMPLETE",
            attempt: 1,
            inputFingerprint: input.sha256,
            startedAt: now,
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              productionStages.productionId,
              productionStages.name,
              productionStages.attempt,
            ],
            set: {
              status: "COMPLETE",
              inputFingerprint: input.sha256,
              startedAt: now,
              completedAt: now,
              updatedAt: now,
            },
          })
          .run();

        transaction
          .insert(artifacts)
          .values({
            id: `${id}-source`,
            productionId: id,
            productionStageId: stageId,
            kind: "SOURCE_VIDEO",
            storageKey: input.storageKey,
            mimeType: input.mimeType,
            byteSize: input.byteSize,
            sha256: input.sha256,
            parentArtifactIdsJson: "[]",
            provider: "USER_UPLOAD",
            metadataJson: JSON.stringify(input.metadata),
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: artifacts.id,
            set: {
              productionStageId: stageId,
              byteSize: input.byteSize,
              sha256: input.sha256,
              metadataJson: JSON.stringify(input.metadata),
              createdAt: now,
            },
          })
          .run();

        transaction
          .update(productions)
          .set({ updatedAt: now })
          .where(eq(productions.id, id))
          .run();

        return getDetail(id)!;
      });
    },

    /**
     * Atomic start gate. In one transaction it verifies persisted rights,
     * the approved candidate, the probed source against the segment, and the
     * one-active-job-per-candidate rule, then runs the domain QUEUE
     * transition and seeds the pipeline stages. Concurrent callers cannot
     * interleave: better-sqlite3 transactions are synchronous.
     */
    start(id: string, now: Date): ProductionDetailResponse {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, id))
          .get();
        if (!row) throw new ProductionGateError("PRODUCTION_NOT_FOUND");
        if (!row.rightsConfirmationId) {
          throw new ProductionGateError("RIGHTS_REQUIRED");
        }

        const rights = getRightsConfirmation(
          row.rightsConfirmationId,
          row.candidateId,
        );
        if (!rights) throw new ProductionGateError("RIGHTS_REQUIRED");

        const candidate = transaction
          .select({ status: candidates.status })
          .from(candidates)
          .where(eq(candidates.id, row.candidateId))
          .get();
        if (!candidate || candidate.status !== "APPROVED") {
          throw new ProductionGateError("APPROVED_CANDIDATE_REQUIRED");
        }

        const source = transaction
          .select({ metadataJson: artifacts.metadataJson })
          .from(artifacts)
          .where(
            and(
              eq(artifacts.productionId, id),
              eq(artifacts.kind, "SOURCE_VIDEO"),
            ),
          )
          .get();
        if (!source) throw new ProductionGateError("SOURCE_REQUIRED");

        const metadata = sourceMetadataSchema.safeParse(
          JSON.parse(source.metadataJson) as unknown,
        );
        if (!metadata.success) throw new ProductionGateError("SOURCE_REQUIRED");
        if (!metadata.data.audioPresent) {
          throw new ProductionGateError("SOURCE_AUDIO_REQUIRED");
        }
        if (metadata.data.durationSeconds < row.segmentEndMs / 1000) {
          throw new ProductionGateError("SOURCE_TOO_SHORT");
        }

        const activeConflict = transaction
          .select({ id: productions.id })
          .from(productions)
          .where(
            and(
              eq(productions.candidateId, row.candidateId),
              ne(productions.id, id),
              inArray(productions.status, [...activeProductionStatuses]),
            ),
          )
          .get();
        if (activeConflict) {
          throw new ProductionGateError("PRODUCTION_ALREADY_ACTIVE");
        }

        transitionProduction(
          buildDomainJob(row, {
            confirmedAt: rights.confirmedAt,
            confirmationTextVersion: rights.confirmationTextVersion,
          }),
          {
            type: "QUEUE",
            candidateStatus: candidate.status,
            segment: segmentFromMilliseconds(row),
          },
        );

        transaction
          .update(productions)
          .set({ status: "QUEUED", updatedAt: now })
          .where(eq(productions.id, id))
          .run();

        for (const name of remainingPipelineStages) {
          transaction
            .insert(productionStages)
            .values({
              id: `${id}-${name}`,
              productionId: id,
              name,
              status: "WAITING",
              attempt: 1,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({
              target: [
                productionStages.productionId,
                productionStages.name,
                productionStages.attempt,
              ],
            })
            .run();
        }

        return getDetail(id)!;
      });
    },
  };
}

export type ProductionRepository = ReturnType<
  typeof createProductionRepository
>;
