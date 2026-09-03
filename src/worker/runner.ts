import {
  createDefaultStageExecutors,
  computeStageFingerprint,
  defaultStageLeaseMs,
  stageInputKinds,
  stagePhase,
  WorkerStageError,
  type PipelineStageName,
  type StageExecutor,
  type StageExecutorContext,
  type StageUpstreamArtifact,
} from "@/server/productions/pipeline";
import {
  createRunwayAnimationStageExecutor,
  resolveRunwayStageConfig,
} from "@/server/productions/runway-stage";
import { createHttpRunwayTransport, RunwayAnimationError } from "@/lib/runway";
import type { AnimationProvider } from "@/lib/providers";
import { parseServerEnvironment } from "@/lib/env-schema";
import {
  createProductionWorkerRepository,
  type PipelineStageState,
  type PipelineState,
} from "@/server/productions/worker-repository";
import { createLogger, type Logger } from "@/lib/logger";
import type { ArtifactStore } from "@/lib/artifact-store";
import type { DatabaseConnection } from "@/server/db/client";

export interface WorkerTickOptions {
  workerId: string;
  leaseMs?: number;
  /** Test seam: override individual stage executors. */
  executors?: Partial<Record<PipelineStageName, StageExecutor>>;
  logger?: Logger;
}

export interface WorkerTickInput {
  database: DatabaseConnection["database"];
  store: ArtifactStore;
  options: WorkerTickOptions;
}

interface StageFailure {
  errorCode: string;
  safeErrorMessage: string;
  errorDetail: string;
  providerRequestId?: string | null;
}

function describeFailure(error: unknown): StageFailure {
  if (error instanceof WorkerStageError) {
    return {
      errorCode: error.code,
      safeErrorMessage: "A media processing step failed for this stage.",
      errorDetail: error.message,
    };
  }
  if (error instanceof RunwayAnimationError) {
    return {
      errorCode: error.code,
      safeErrorMessage: "A media processing step failed for this stage.",
      errorDetail: error.message,
      providerRequestId: error.requestId,
    };
  }
  return {
    errorCode: "MEDIA_PROCESSING_FAILED",
    safeErrorMessage: "A media processing step failed for this stage.",
    errorDetail: error instanceof Error ? error.message : "Unknown error",
  };
}

/**
 * Provider-aware executor selection: the production's persisted animation
 * selection decides which ANIMATE_IMAGE executor runs, so environment
 * changes after job creation cannot rewrite a job's provider behavior.
 */
export function selectDefaultStageExecutor(
  stageName: PipelineStageName,
  animationProvider: AnimationProvider,
  defaults: Record<PipelineStageName, StageExecutor>,
  createRunwayAnimationExecutor?: () => StageExecutor,
): StageExecutor {
  if (stageName === "ANIMATE_IMAGE" && animationProvider === "RUNWAY") {
    if (!createRunwayAnimationExecutor) {
      throw new WorkerStageError(
        "PROVIDER_REQUEST_FAILED",
        "RUNWAY animation is selected but no animation executor is configured.",
      );
    }
    return createRunwayAnimationExecutor();
  }
  return defaults[stageName];
}

/**
 * One worker poll tick: claims at most one claimable stage across the
 * active productions and runs it to completion or failure. Each tick
 * processes one stage so long FFmpeg work cannot starve other productions.
 */
export async function runWorkerTick(input: WorkerTickInput): Promise<void> {
  const logger = input.options.logger ?? createLogger();
  const repository = createProductionWorkerRepository(
    input.database,
    input.store,
  );
  const defaults = createDefaultStageExecutors();
  const leaseMs = input.options.leaseMs ?? defaultStageLeaseMs;

  // Built lazily: only a production persisted with animationProvider=RUNWAY
  // constructs the live transport, so mock/mock stays credential-free.
  let runwayAnimationExecutor: StageExecutor | undefined;
  const getRunwayAnimationExecutor = (): StageExecutor => {
    // resolveRunwayStageConfig fails fast when RUNWAY is selected without
    // valid credentials, so the transport only ever sees validated secrets.
    const runwayConfig = resolveRunwayStageConfig(
      parseServerEnvironment(process.env),
    );
    runwayAnimationExecutor ??= createRunwayAnimationStageExecutor({
      transport: createHttpRunwayTransport(runwayConfig),
      config: runwayConfig,
    });
    return runwayAnimationExecutor;
  };

  for (const productionId of repository.listActiveProductionIds()) {
    const state = repository.loadPipelineState(productionId);
    if (!state) continue;
    const next = state.stages.find((stage) => stage.status !== "COMPLETE");
    if (!next || next.status === "FAILED") continue;

    await processStage(state, next);
  }

  async function processStage(
    state: PipelineState,
    stage: PipelineStageState,
  ): Promise<void> {
    const productionId = state.production.id;
    const phase = stagePhase[stage.name];
    const now = new Date();
    const workerId = input.options.workerId;

    if (state.production.status === "QUEUED") {
      if (stage.name !== "EXTRACT_MEDIA") {
        logger.error("Queued production has no EXTRACT_MEDIA stage to claim", {
          workerId,
          errorCode: "WORKER_PIPELINE_STATE_INVALID",
          productionId,
          stage: stage.name,
        });
        return;
      }
      if (
        !repository.claimStage({
          stageRowId: stage.row.id,
          stageName: stage.name,
          productionId,
          workerId,
          now,
          leaseMs,
        })
      ) {
        return;
      }
      try {
        repository.beginExtraction({ productionId, workerId, now: new Date() });
      } catch (error) {
        repository.releaseStageLease({
          stageRowId: stage.row.id,
          workerId,
          now: new Date(),
        });
        logger.error("Worker failed to start the queued production", {
          workerId,
          errorCode: "WORKER_START_FAILED",
          productionId,
          errorDetail: error instanceof Error ? error.message : "Unknown error",
        });
        return;
      }
    } else if (state.production.status === phase) {
      if (
        !repository.claimStage({
          stageRowId: stage.row.id,
          stageName: stage.name,
          productionId,
          workerId,
          now,
          leaseMs,
        })
      ) {
        return;
      }
    } else {
      return;
    }

    logger.info("Worker claimed a production stage", {
      workerId,
      productionId,
      stage: stage.name,
      attempt: stage.attempt,
    });
    await executeClaimedStage(state, stage);
  }

  async function executeClaimedStage(
    state: PipelineState,
    stage: PipelineStageState,
  ): Promise<void> {
    const productionId = state.production.id;
    const workerId = input.options.workerId;
    const executor =
      input.options.executors?.[stage.name] ??
      selectDefaultStageExecutor(
        stage.name,
        state.production.animationProvider,
        defaults,
        getRunwayAnimationExecutor,
      );

    try {
      const context = buildExecutorContext(state, stage);
      const result = await executor(context);
      const fingerprint = computeStageFingerprint(stage.name, {
        productionId,
        segment: {
          startMs: state.production.segmentStartMs,
          endMs: state.production.segmentEndMs,
          durationMs: state.production.segmentDurationMs,
        },
        upstream: stageInputKinds[stage.name].map((kind) => ({
          kind,
          sha256:
            state.artifactRows.find((row) => row.kind === kind)?.sha256 ?? "",
        })),
      });

      repository.completeStage({
        productionId,
        stageRowId: stage.row.id,
        stageName: stage.name,
        workerId,
        fingerprint,
        newArtifacts: result.artifacts,
        validationReport: result.validationReport,
        now: new Date(),
      });
      logger.info("Worker completed a production stage", {
        workerId,
        productionId,
        stage: stage.name,
        attempt: stage.attempt,
      });
    } catch (error) {
      const failure = describeFailure(error);
      try {
        repository.failStage({
          productionId,
          stageRowId: stage.row.id,
          workerId,
          errorCode: failure.errorCode,
          safeErrorMessage: failure.safeErrorMessage,
          providerRequestId: failure.providerRequestId ?? null,
          now: new Date(),
        });
      } catch (persistError) {
        // A lost lease means another worker owns the stage now; keep the
        // original failure in the log and let the owner finish its bookkeeping.
        logger.error("Worker failed to persist a stage failure", {
          workerId,
          productionId,
          stage: stage.name,
          errorCode: "WORKER_FAILURE_PERSIST_FAILED",
          errorDetail:
            persistError instanceof Error
              ? persistError.message
              : "Unknown error",
        });
        return;
      }
      logger.error("Worker stage failed", {
        workerId,
        productionId,
        stage: stage.name,
        attempt: stage.attempt,
        errorCode: failure.errorCode,
        errorDetail: failure.errorDetail,
      });
    }
  }

  function buildExecutorContext(
    state: PipelineState,
    stage: PipelineStageState,
  ): StageExecutorContext {
    const upstream: StageUpstreamArtifact[] = [];
    for (const kind of stageInputKinds[stage.name]) {
      const row = state.artifactRows.find((artifact) => artifact.kind === kind);
      if (!row) {
        throw new WorkerStageError(
          "UPSTREAM_ARTIFACT_MISSING",
          `Upstream ${kind} artifact row is missing.`,
        );
      }
      upstream.push({
        kind,
        id: row.id,
        storageKey: row.storageKey,
        sha256: row.sha256,
      });
    }
    return {
      productionId: state.production.id,
      segment: {
        startMs: state.production.segmentStartMs,
        endMs: state.production.segmentEndMs,
        durationMs: state.production.segmentDurationMs,
      },
      upstream,
      store: input.store,
      priorProviderRequestId: findPriorProviderRequestId(state, stage),
      recordProviderRequestId: async (requestId) =>
        repository.recordStageProviderRequestId({
          stageRowId: stage.row.id,
          workerId: input.options.workerId,
          providerRequestId: requestId,
          now: new Date(),
        }),
    };
  }

  /**
   * The persisted anchor for reconcile-before-retry: this attempt's own row
   * first (crash recovery), else the latest prior attempt's ID (retry).
   */
  function findPriorProviderRequestId(
    state: PipelineState,
    stage: PipelineStageState,
  ): string | null {
    if (stage.row.providerRequestId) return stage.row.providerRequestId;
    const priorRows = state.stageRows.filter(
      (row) =>
        row.name === stage.name &&
        row.attempt < stage.attempt &&
        row.providerRequestId,
    );
    if (priorRows.length === 0) return null;
    return (
      priorRows.reduce((latest, row) =>
        row.attempt > latest.attempt ? row : latest,
      ).providerRequestId ?? null
    );
  }
}
