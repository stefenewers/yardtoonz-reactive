import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import {
  expectedArtifactProvider,
  phaseOutputKinds,
  phaseRequiredUpstreamKinds,
  transitionProduction,
  ProductionTransitionError,
  type ProductionArtifactRecord,
  type ProductionJob,
  type ValidationReport,
  type WorkerOwnedStatus,
} from "@/domain/production";
import { ArtifactStoreError, type ArtifactStore } from "@/lib/artifact-store";

import { ProductionGateError } from "./errors";
import {
  agentKeyForStage,
  failedRunDecision,
  modelLabelFromMetadata,
  stageCompleteConfidence,
  stageCompleteDecision,
  stageCompleteEvidence,
  stageFailedEvidence,
  stageProviderForRun,
} from "@/domain/agent-trace";
import { insertAgentRun } from "../agents/trace";
import {
  getArtifactRecordId,
  isPipelineStageName,
  phaseEntryStage,
  pipelineStageOrder,
  stageOutputDefinitions,
  stagePhase,
  type PipelineStageName,
  type StageOutputArtifact,
} from "./pipeline";
import {
  artifacts,
  productions,
  productionStages,
  rightsConfirmations,
} from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type ProductionRow = typeof productions.$inferSelect;
type StageRow = typeof productionStages.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

/**
 * Stage row for trace attribution. Unreachable after the guarded lease
 * update proved the row exists — the error type matches the race it would
 * otherwise describe.
 */
function getStageRowForTrace(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  stageRowId: string,
): StageRow {
  const row = transaction
    .select()
    .from(productionStages)
    .where(eq(productionStages.id, stageRowId))
    .get();
  if (!row) throw new ProductionTransitionError("WORKER_OWNERSHIP_CONFLICT");
  return row;
}

/**
 * Measured stage wall time for a trace row. Clamped to zero so a backward
 * clock jump can never violate the non-negative elapsed check constraint.
 */
function stageElapsedMs(row: StageRow, now: Date): number | null {
  if (!row.startedAt) return null;
  return Math.max(0, now.getTime() - row.startedAt.getTime());
}

/** Statuses in which a production has claimable worker work. */
const activeProductionStatuses = [
  "QUEUED",
  "EXTRACTING",
  "STYLING",
  "ANIMATING",
  "MUXING",
  "VALIDATING",
] as const;

export interface PipelineStageState {
  readonly row: StageRow;
  readonly name: PipelineStageName;
  readonly status: StageRow["status"];
  readonly attempt: number;
  readonly inputFingerprint: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAtMs: number | null;
}

export interface PipelineState {
  readonly production: ProductionRow;
  /** Latest attempt of each worker stage, in canonical pipeline order. */
  readonly stages: readonly PipelineStageState[];
  /** Every stage row including superseded retry attempts. */
  readonly stageRows: readonly StageRow[];
  readonly artifactRows: readonly ArtifactRow[];
}

export interface ClaimStageInput {
  readonly stageRowId: string;
  readonly stageName: PipelineStageName;
  readonly productionId: string;
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface CompleteStageInput {
  readonly productionId: string;
  readonly stageRowId: string;
  readonly stageName: PipelineStageName;
  readonly workerId: string;
  readonly fingerprint: string;
  readonly newArtifacts: readonly StageOutputArtifact[];
  /** Required when the completing stage ends the VALIDATING phase. */
  readonly validationReport?: ValidationReport;
  readonly now: Date;
}

export interface FailStageInput {
  readonly productionId: string;
  readonly stageRowId: string;
  readonly workerId: string;
  readonly errorCode: string;
  readonly safeErrorMessage: string;
  /** Live-provider request ID persisted so a retry reconciles instead of regenerating. */
  readonly providerRequestId?: string | null;
  readonly now: Date;
}

/**
 * Persistence for the mock worker media pipeline. Worker ownership is the
 * stage lease (Technical Specification §7 invariant 3): a guarded update
 * hands a stage to exactly one worker, and a lost lease aborts the stage's
 * persistence. Artifact rows use one stable id per production and kind, so
 * retries rewrite in place and never duplicate records (invariant 6).
 */
export function createProductionWorkerRepository(
  database: Database,
  store: ArtifactStore,
) {
  /** Wire segments are seconds; persistence stores whole milliseconds. */
  function segmentFromRow(row: {
    segmentStartMs: number;
    segmentEndMs: number;
    segmentDurationMs: number;
  }) {
    return {
      startSeconds: row.segmentStartMs / 1000,
      endSeconds: row.segmentEndMs / 1000,
      durationSeconds: row.segmentDurationMs / 1000,
    };
  }

  function getProductionRow(id: string): ProductionRow | undefined {
    return database
      .select()
      .from(productions)
      .where(eq(productions.id, id))
      .get();
  }

  function getRights(production: ProductionRow) {
    if (!production.rightsConfirmationId) return undefined;
    const rights = database
      .select()
      .from(rightsConfirmations)
      .where(
        and(
          eq(rightsConfirmations.id, production.rightsConfirmationId),
          eq(rightsConfirmations.candidateId, production.candidateId),
        ),
      )
      .get();
    if (!rights) return undefined;
    return {
      confirmedAt: rights.confirmedAt,
      confirmationTextVersion: rights.confirmationTextVersion,
    };
  }

  function getStageRows(productionId: string): StageRow[] {
    return database
      .select()
      .from(productionStages)
      .where(eq(productionStages.productionId, productionId))
      .all();
  }

  function getArtifactRows(productionId: string): ArtifactRow[] {
    return database
      .select()
      .from(artifacts)
      .where(eq(artifacts.productionId, productionId))
      .all();
  }

  /**
   * Builds the domain ProductionJob for transition validation. Worker
   * transitions pass their artifacts through the transition itself, so the
   * persisted set is only included when asked (the RETRY verification needs
   * it). `actorWorkerId` carries the stage lease owner so the domain's
   * single-owner check validates against the lease.
   */
  function buildDomainJob(input: {
    production: ProductionRow;
    artifactRecords?: readonly ProductionArtifactRecord[];
    actorWorkerId?: string;
  }): ProductionJob {
    const production = input.production;
    const rights = getRights(production);
    const activeStage = production.activeStage;
    const failedStage =
      production.status === "FAILED" &&
      activeStage !== null &&
      isPipelineStageName(activeStage)
        ? stagePhase[activeStage]
        : undefined;
    return {
      id: production.id,
      candidateId: production.candidateId,
      status: production.status,
      imageProvider: production.imageProvider,
      animationProvider: production.animationProvider,
      rights: rights ? { confirmed: true as const, ...rights } : undefined,
      segment: segmentFromRow(production),
      activeWorkerId: input.actorWorkerId,
      failedStage,
      artifacts: input.artifactRecords ?? [],
      errorCode: production.errorCode ?? undefined,
      errorMessage: production.safeErrorMessage ?? undefined,
    };
  }

  function toDomainArtifactRecords(
    stageRows: readonly StageRow[],
    artifactRows: readonly ArtifactRow[],
  ): ProductionArtifactRecord[] {
    const fingerprintByStageId = new Map(
      stageRows.map((row) => [row.id, row.inputFingerprint]),
    );
    return artifactRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      provider: row.provider,
      inputFingerprint:
        fingerprintByStageId.get(row.productionStageId) ?? row.sha256,
      storagePresent: true as const,
    }));
  }

  function toStageState(row: StageRow): PipelineStageState | undefined {
    if (!isPipelineStageName(row.name)) return undefined;
    return {
      row,
      name: row.name,
      status: row.status,
      attempt: row.attempt,
      inputFingerprint: row.inputFingerprint,
      leaseOwner: row.workerLeaseOwner,
      leaseExpiresAtMs: row.workerLeaseExpiresAt?.getTime() ?? null,
    };
  }

  function loadPipelineState(productionId: string): PipelineState | undefined {
    const production = getProductionRow(productionId);
    if (!production) return undefined;

    const stageRows = getStageRows(productionId);
    const latestByName = new Map<string, StageRow>();
    for (const row of stageRows) {
      const existing = latestByName.get(row.name);
      if (!existing || row.attempt > existing.attempt) {
        latestByName.set(row.name, row);
      }
    }
    const stages = pipelineStageOrder
      .map((name) => latestByName.get(name))
      .filter((row): row is StageRow => row !== undefined)
      .map(toStageState)
      .filter((state): state is PipelineStageState => state !== undefined);

    return {
      production,
      stages,
      stageRows,
      artifactRows: getArtifactRows(productionId),
    };
  }

  return {
    buildDomainJob,
    loadPipelineState,

    listActiveProductionIds(): string[] {
      return database
        .select({ id: productions.id })
        .from(productions)
        .where(inArray(productions.status, [...activeProductionStatuses]))
        .orderBy(asc(productions.updatedAt))
        .all()
        .map((row) => row.id);
    },

    /**
     * Atomically claims a WAITING stage — or a RUNNING stage whose lease has
     * expired — for this worker. The guarded update is the single-owner
     * guarantee: concurrent claimants mutate at most one row.
     */
    claimStage(input: ClaimStageInput): boolean {
      return database.transaction((transaction) => {
        const row = transaction
          .select()
          .from(productionStages)
          .where(eq(productionStages.id, input.stageRowId))
          .get();
        if (!row) return false;

        const claimable =
          row.status === "WAITING" ||
          (row.status === "RUNNING" &&
            (row.workerLeaseOwner === null ||
              (row.workerLeaseExpiresAt?.getTime() ?? 0) <=
                input.now.getTime()));
        if (!claimable) return false;

        const claimed = transaction
          .update(productionStages)
          .set({
            status: "RUNNING",
            workerLeaseOwner: input.workerId,
            workerLeaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
            startedAt: row.startedAt ?? input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(productionStages.id, input.stageRowId),
              or(
                eq(productionStages.status, "WAITING"),
                and(
                  eq(productionStages.status, "RUNNING"),
                  or(
                    isNull(productionStages.workerLeaseOwner),
                    lt(productionStages.workerLeaseExpiresAt, input.now),
                  ),
                ),
              ),
            ),
          )
          .run();
        if (claimed.changes !== 1) return false;

        transaction
          .update(productions)
          .set({ activeStage: input.stageName, updatedAt: input.now })
          .where(eq(productions.id, input.productionId))
          .run();
        return true;
      });
    },

    /** Returns an accidentally held lease to the claimable pool. */
    releaseStageLease(input: {
      stageRowId: string;
      workerId: string;
      now: Date;
    }): void {
      database
        .update(productionStages)
        .set({
          status: "WAITING",
          workerLeaseOwner: null,
          workerLeaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(productionStages.id, input.stageRowId),
            eq(productionStages.status, "RUNNING"),
            eq(productionStages.workerLeaseOwner, input.workerId),
          ),
        )
        .run();
    },

    /** QUEUED → EXTRACTING through the one domain START transition. */
    beginExtraction(input: {
      productionId: string;
      workerId: string;
      now: Date;
    }): void {
      database.transaction((transaction) => {
        const production = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, input.productionId))
          .get();
        if (!production) throw new ProductionGateError("PRODUCTION_NOT_FOUND");

        transitionProduction(
          buildDomainJob({ production, actorWorkerId: input.workerId }),
          { type: "START", workerId: input.workerId },
        );

        transaction
          .update(productions)
          .set({
            status: "EXTRACTING",
            activeStage: "EXTRACT_MEDIA",
            updatedAt: input.now,
          })
          .where(eq(productions.id, input.productionId))
          .run();
      });
    },

    /**
     * Persists a completed stage: guarded by the live lease, artifacts are
     * upserted in place, and when the stage ends its phase the domain
     * ADVANCE transition moves the production forward in the same
     * transaction. A lost lease aborts everything.
     */
    completeStage(input: CompleteStageInput): void {
      database.transaction((transaction) => {
        const completed = transaction
          .update(productionStages)
          .set({
            status: "COMPLETE",
            inputFingerprint: input.fingerprint,
            completedAt: input.now,
            updatedAt: input.now,
            workerLeaseOwner: null,
            workerLeaseExpiresAt: null,
          })
          .where(
            and(
              eq(productionStages.id, input.stageRowId),
              eq(productionStages.status, "RUNNING"),
              eq(productionStages.workerLeaseOwner, input.workerId),
            ),
          )
          .run();
        if (completed.changes !== 1) {
          throw new ProductionTransitionError("WORKER_OWNERSHIP_CONFLICT");
        }

        const production = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, input.productionId))
          .get();
        if (!production) throw new ProductionGateError("PRODUCTION_NOT_FOUND");

        const definitionByKind = new Map(
          stageOutputDefinitions[input.stageName].map((definition) => [
            definition.kind,
            definition,
          ]),
        );
        for (const artifact of input.newArtifacts) {
          const parentIds = definitionByKind
            .get(artifact.kind)
            ?.parentKinds.map((kind) =>
              getArtifactRecordId(input.productionId, kind),
            );
          transaction
            .insert(artifacts)
            .values({
              id: getArtifactRecordId(input.productionId, artifact.kind),
              productionId: input.productionId,
              productionStageId: input.stageRowId,
              kind: artifact.kind,
              storageKey: artifact.storageKey,
              mimeType: artifact.mimeType,
              byteSize: artifact.byteSize,
              sha256: artifact.sha256,
              parentArtifactIdsJson: JSON.stringify(parentIds ?? []),
              provider: expectedArtifactProvider(artifact.kind, production),
              providerRequestId: artifact.providerRequestId ?? null,
              metadataJson: JSON.stringify(artifact.metadata),
              createdAt: input.now,
            })
            .onConflictDoUpdate({
              target: artifacts.id,
              set: {
                productionStageId: input.stageRowId,
                byteSize: artifact.byteSize,
                sha256: artifact.sha256,
                parentArtifactIdsJson: JSON.stringify(parentIds ?? []),
                providerRequestId: artifact.providerRequestId ?? null,
                metadataJson: JSON.stringify(artifact.metadata),
                createdAt: input.now,
              },
            })
            .run();
        }

        // Named-agent trace: the run joins this transaction, so a trace row
        // exists exactly when the stage's work persisted.
        const agentKey = agentKeyForStage(input.stageName);
        if (agentKey) {
          const stageRow = getStageRowForTrace(transaction, input.stageRowId);
          const provider = stageProviderForRun(input.stageName, production);
          insertAgentRun(transaction, {
            agentKey,
            state: "COMPLETE",
            attempt: stageRow.attempt,
            inputEvidence: stageCompleteEvidence({
              stageName: input.stageName,
              fingerprint: input.fingerprint,
              validationReport: input.validationReport,
            }),
            decision: stageCompleteDecision({
              stageName: input.stageName,
              provider,
              validationReport: input.validationReport,
            }),
            confidence: stageCompleteConfidence(input.stageName),
            provider,
            model: modelLabelFromMetadata(
              input.newArtifacts[0]?.metadata ?? {},
            ),
            elapsedMs: stageElapsedMs(stageRow, input.now),
            artifactIds: input.newArtifacts.map((artifact) =>
              getArtifactRecordId(input.productionId, artifact.kind),
            ),
            candidateId: production.candidateId,
            productionId: production.id,
            now: input.now,
          });
        }

        const phase = stagePhase[input.stageName];
        if (production.status !== phase) return;

        const orderIndex = pipelineStageOrder.indexOf(input.stageName);
        const nextStage = pipelineStageOrder[orderIndex + 1];
        if (nextStage && stagePhase[nextStage] === phase) return;

        // The stage ends its phase: validate the domain ADVANCE against the
        // phase's full output set, then persist status and stage pointer.
        const newRecords = new Map(
          input.newArtifacts.map((artifact) => [artifact.kind, artifact]),
        );
        const phaseArtifacts: ProductionArtifactRecord[] = [];
        for (const kind of phaseOutputKinds[phase]) {
          const fresh = newRecords.get(kind);
          if (fresh) {
            phaseArtifacts.push({
              id: getArtifactRecordId(input.productionId, kind),
              kind,
              provider: expectedArtifactProvider(kind, production),
              inputFingerprint: input.fingerprint,
              storagePresent: true,
            });
            continue;
          }
          const persisted = toDomainArtifactRecords(
            getStageRows(input.productionId),
            getArtifactRows(input.productionId).filter(
              (row) => row.kind === kind,
            ),
          );
          if (persisted.length !== 1) {
            throw new ProductionTransitionError("ARTIFACT_INVARIANT_VIOLATION");
          }
          phaseArtifacts.push(persisted[0]!);
        }

        const nextJob = transitionProduction(
          buildDomainJob({ production, actorWorkerId: input.workerId }),
          {
            type: "ADVANCE",
            workerId: input.workerId,
            artifacts: phaseArtifacts,
            validationReport: input.validationReport,
          },
        );

        transaction
          .update(productions)
          .set({
            status: nextJob.status,
            activeStage:
              nextJob.status === "COMPLETE"
                ? null
                : (phaseEntryStage[nextJob.status as WorkerOwnedStatus] ??
                  null),
            completedAt: nextJob.status === "COMPLETE" ? input.now : undefined,
            updatedAt: input.now,
          })
          .where(eq(productions.id, input.productionId))
          .run();
      });
    },

    /** Marks the leased stage and its production FAILED through the domain FAIL transition. */
    failStage(input: FailStageInput): void {
      database.transaction((transaction) => {
        const failed = transaction
          .update(productionStages)
          .set({
            status: "FAILED",
            errorCode: input.errorCode,
            safeErrorMessage: input.safeErrorMessage,
            providerRequestId: input.providerRequestId ?? null,
            completedAt: input.now,
            updatedAt: input.now,
            workerLeaseOwner: null,
            workerLeaseExpiresAt: null,
          })
          .where(
            and(
              eq(productionStages.id, input.stageRowId),
              eq(productionStages.status, "RUNNING"),
              eq(productionStages.workerLeaseOwner, input.workerId),
            ),
          )
          .run();
        if (failed.changes !== 1) {
          throw new ProductionTransitionError("WORKER_OWNERSHIP_CONFLICT");
        }

        const production = transaction
          .select()
          .from(productions)
          .where(eq(productions.id, input.productionId))
          .get();
        if (!production) throw new ProductionGateError("PRODUCTION_NOT_FOUND");

        transitionProduction(
          buildDomainJob({ production, actorWorkerId: input.workerId }),
          {
            type: "FAIL",
            workerId: input.workerId,
            errorCode: input.errorCode,
            errorMessage: input.safeErrorMessage,
          },
        );

        transaction
          .update(productions)
          .set({
            status: "FAILED",
            errorCode: input.errorCode,
            safeErrorMessage: input.safeErrorMessage,
            updatedAt: input.now,
          })
          .where(eq(productions.id, input.productionId))
          .run();

        // Named-agent trace for the observed failure, same transaction.
        const stageRow = getStageRowForTrace(transaction, input.stageRowId);
        const failedAgentKey = agentKeyForStage(stageRow.name);
        if (failedAgentKey) {
          insertAgentRun(transaction, {
            agentKey: failedAgentKey,
            state: "FAILED",
            attempt: stageRow.attempt,
            inputEvidence: stageFailedEvidence({ errorCode: input.errorCode }),
            decision: failedRunDecision(input.safeErrorMessage),
            provider: stageProviderForRun(stageRow.name, production),
            elapsedMs: stageElapsedMs(stageRow, input.now),
            artifactIds: [],
            candidateId: production.candidateId,
            productionId: production.id,
            now: input.now,
          });
        }
      });
    },

    /**
     * Durable reconcile-before-retry anchor: records the live-provider
     * request ID on the running stage row the moment a provider accepts a
     * request, so a worker crash mid-poll still leaves the ID for the next
     * attempt to reconcile against. Guarded by stage lease ownership.
     */
    recordStageProviderRequestId(input: {
      stageRowId: string;
      workerId: string;
      providerRequestId: string;
      now: Date;
    }): void {
      const updated = database
        .update(productionStages)
        .set({
          providerRequestId: input.providerRequestId,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(productionStages.id, input.stageRowId),
            eq(productionStages.status, "RUNNING"),
            eq(productionStages.workerLeaseOwner, input.workerId),
          ),
        )
        .run();
      if (updated.changes !== 1) {
        throw new ProductionTransitionError("WORKER_OWNERSHIP_CONFLICT");
      }
    },

    /**
     * Idempotently re-arms the failed stage: every required upstream
     * artifact is re-verified against storage (existence and digest), the
     * domain RETRY transition validates the re-arm, and a fresh stage
     * attempt row is seeded for the worker to claim. Upstream artifacts are
     * never rewritten.
     */
    async retryFailedStage(productionId: string, now: Date): Promise<void> {
      const state = loadPipelineState(productionId);
      if (!state) throw new ProductionGateError("PRODUCTION_NOT_FOUND");
      if (state.production.status !== "FAILED") {
        throw new ProductionTransitionError("ILLEGAL_TRANSITION");
      }
      const failedStageName = state.production.activeStage;
      if (!failedStageName || !isPipelineStageName(failedStageName)) {
        throw new ProductionTransitionError("ILLEGAL_TRANSITION");
      }
      const failedStage = state.stages.find(
        (stage) => stage.name === failedStageName,
      );
      if (!failedStage || failedStage.status !== "FAILED") {
        throw new ProductionTransitionError("ILLEGAL_TRANSITION");
      }
      const phase = stagePhase[failedStageName];

      const verifiedIds: string[] = [];
      for (const kind of phaseRequiredUpstreamKinds[phase]) {
        const row = state.artifactRows.find(
          (artifact) => artifact.kind === kind,
        );
        if (!row) {
          throw new ProductionTransitionError("UPSTREAM_ARTIFACTS_REQUIRED");
        }
        try {
          const integrity = await store.inspect(row.storageKey);
          if (integrity.sha256 !== row.sha256) {
            throw new ArtifactStoreError("INVALID_ARTIFACT");
          }
        } catch (error) {
          if (
            error instanceof ProductionTransitionError ||
            error instanceof ProductionGateError
          ) {
            throw error;
          }
          // Missing or altered upstream storage blocks the retry.
          if (error instanceof ArtifactStoreError) {
            throw new ProductionTransitionError("UPSTREAM_ARTIFACTS_REQUIRED");
          }
          throw error;
        }
        verifiedIds.push(row.id);
      }

      // The HTTP caller re-arms the job on the operator's behalf; the next
      // executing worker takes ownership by claiming the stage lease.
      const retryActorId = "api";
      transitionProduction(
        buildDomainJob({
          production: state.production,
          artifactRecords: toDomainArtifactRecords(
            state.stageRows,
            state.artifactRows,
          ),
          actorWorkerId: retryActorId,
        }),
        {
          type: "RETRY",
          workerId: retryActorId,
          verifiedUpstreamArtifactIds: verifiedIds,
        },
      );

      const attempt = failedStage.attempt + 1;
      database.transaction((transaction) => {
        transaction
          .insert(productionStages)
          .values({
            id: `${productionId}-${failedStageName}-${attempt}`,
            productionId,
            name: failedStageName,
            status: "WAITING",
            attempt,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        transaction
          .update(productions)
          .set({
            status: phase,
            attempt: state.production.attempt + 1,
            errorCode: null,
            safeErrorMessage: null,
            updatedAt: now,
          })
          .where(eq(productions.id, productionId))
          .run();
      });
    },
  };
}

export type ProductionWorkerRepository = ReturnType<
  typeof createProductionWorkerRepository
>;
