import "server-only";

import {
  buildOrchestrationTimeline,
  planRun,
  type OrchestrationPlan,
} from "@/domain/orchestration";
import {
  orchestrationTimelineSchema,
  type OrchestrationRunResource,
  type OrchestrationTimeline,
} from "@/shared/orchestration";
import { env } from "@/lib/env";

import { createDatabaseProvider } from "@/server/db/client";
import type * as schema from "@/server/db/schema";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { candidateExists, buildOrchestrationSnapshot } from "./snapshot";
import {
  createOrchestrationRunRepository,
  type OrchestrationRunRepository,
} from "./repository";

type Database = BetterSQLite3Database<typeof schema>;

const maxSafeMessageLength = 400;

export type StartRunOutcome =
  | {
      readonly created: boolean;
      readonly run: OrchestrationRunResource;
      readonly timeline: OrchestrationTimeline;
    }
  | "CANDIDATE_NOT_FOUND";

export type RunDetailOutcome =
  | {
      readonly run: OrchestrationRunResource;
      readonly timeline: OrchestrationTimeline;
    }
  | "RUN_NOT_FOUND";

export type ResumeRunOutcome =
  | {
      readonly run: OrchestrationRunResource;
      readonly timeline: OrchestrationTimeline;
    }
  | "RUN_NOT_FOUND"
  | "RESUME_NOT_ALLOWED";

export type CancelRunOutcome =
  | {
      readonly run: OrchestrationRunResource;
      readonly timeline: OrchestrationTimeline;
    }
  | "RUN_NOT_FOUND"
  | "CANCEL_NOT_ALLOWED";

function truncateSafeMessage(message: string): string {
  return message.length > maxSafeMessageLength
    ? `${message.slice(0, maxSafeMessageLength - 3)}...`
    : message;
}

export interface OrchestrationServiceDeps {
  readonly database: Database;
  /** Injectable clock so runs are deterministic in tests. */
  now?: () => Date;
}

/**
 * The orchestration sequencer. The run row records identity and human
 * intent; step progress is always re-derived from the persisted agent
 * trace. `sync` advances RUNNING runs; FAILED runs are sticky and leave
 * only through the explicit `resume` — a human must confirm the recovery,
 * matching the MVP's human-in-the-loop control.
 */
export function createOrchestrationService(deps: OrchestrationServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const runs = createOrchestrationRunRepository(deps.database);

  function timelineFor(run: OrchestrationRunResource): OrchestrationTimeline {
    const snapshot = buildOrchestrationSnapshot(deps.database, run.candidateId);
    // Parse through the shared contract so the served payload is validated
    // at the source and the domain type never leaks into API responses.
    return orchestrationTimelineSchema.parse(
      buildOrchestrationTimeline(planRun(snapshot)),
    );
  }

  function detail(run: OrchestrationRunResource): {
    readonly run: OrchestrationRunResource;
    readonly timeline: OrchestrationTimeline;
  } {
    return { run, timeline: timelineFor(run) };
  }

  /**
   * Re-derive the cursor from the persisted trace and advance a RUNNING
   * run: past completed steps, to FAILED when the current step failed, or
   * to COMPLETE when all six steps are done. Pure with respect to the
   * trace — the same rows always produce the same outcome.
   */
  function sync(run: OrchestrationRunResource): OrchestrationRunResource {
    if (run.status !== "RUNNING") return run;

    const snapshot = buildOrchestrationSnapshot(deps.database, run.candidateId);
    const plan = planRun(snapshot);
    const timestamp = now();

    if (plan.complete) {
      const updated = runs.update({
        id: run.id,
        status: "COMPLETE",
        currentStepKey: null,
        completedAt: timestamp,
        now: timestamp,
      });
      return updated ?? run;
    }

    if (plan.failedStepKey !== null) {
      const updated = runs.update({
        id: run.id,
        status: "FAILED",
        currentStepKey: plan.currentStepKey,
        errorCode: plan.errorCode ?? "STEP_FAILED",
        safeErrorMessage: failedMessage(plan),
        now: timestamp,
      });
      return updated ?? run;
    }

    if (run.currentStepKey !== plan.currentStepKey) {
      const updated = runs.update({
        id: run.id,
        currentStepKey: plan.currentStepKey,
        now: timestamp,
      });
      return updated ?? run;
    }

    return run;
  }

  function failedMessage(plan: OrchestrationPlan): string {
    const step = plan.steps.find(
      (entry) => entry.agentKey === plan.failedStepKey,
    );
    const message =
      step?.decision ??
      (step?.errorCode
        ? `Agent step failed: ${step.errorCode}`
        : "Agent step failed.");
    return truncateSafeMessage(message);
  }

  return {
    /**
     * Start tracking the six-agent sequence for a candidate. Idempotent:
     * an existing active (RUNNING or FAILED) run is returned unchanged —
     * starting twice never resets progress or duplicates a run.
     */
    start(candidateId: string): StartRunOutcome {
      if (!candidateExists(deps.database, candidateId)) {
        return "CANDIDATE_NOT_FOUND";
      }

      const active = runs.activeForCandidate(candidateId);
      if (active) return { created: false, ...detail(active) };

      const snapshot = buildOrchestrationSnapshot(deps.database, candidateId);
      const plan = planRun(snapshot);
      const run = runs.create({
        candidateId,
        currentStepKey: plan.currentStepKey,
        now: now(),
      });
      return { created: true, ...detail(run) };
    },

    /** Advance a RUNNING run against current persisted state. */
    sync(runId: string): RunDetailOutcome {
      const run = runs.get(runId);
      if (!run) return "RUN_NOT_FOUND";
      return detail(sync(run));
    },

    /**
     * Explicitly re-enter a FAILED run after the underlying subsystem
     * recovered (e.g. a human retried the failed stage). The run only
     * moves when the persisted trace now supports progress; a run that is
     * still blocked stays FAILED so the operator sees the real state.
     */
    resume(runId: string): ResumeRunOutcome {
      const run = runs.get(runId);
      if (!run) return "RUN_NOT_FOUND";
      if (run.status !== "FAILED") return "RESUME_NOT_ALLOWED";

      const snapshot = buildOrchestrationSnapshot(
        deps.database,
        run.candidateId,
      );
      const plan = planRun(snapshot);
      const timestamp = now();

      if (plan.complete) {
        // Leaving FAILED requires clearing the failure fields: the run table
        // constrains error reporting to FAILED rows only.
        const updated = runs.update({
          id: run.id,
          status: "COMPLETE",
          currentStepKey: null,
          errorCode: null,
          safeErrorMessage: null,
          completedAt: timestamp,
          now: timestamp,
        });
        return detail(updated ?? run);
      }

      if (plan.failedStepKey === null) {
        const updated = runs.update({
          id: run.id,
          status: "RUNNING",
          currentStepKey: plan.currentStepKey,
          errorCode: null,
          safeErrorMessage: null,
          now: timestamp,
        });
        return detail(updated ?? run);
      }

      // Still failing: refresh the recorded error but stay FAILED.
      const updated = runs.update({
        id: run.id,
        status: "FAILED",
        currentStepKey: plan.currentStepKey,
        errorCode: plan.errorCode ?? "STEP_FAILED",
        safeErrorMessage: failedMessage(plan),
        now: timestamp,
      });
      return detail(updated ?? run);
    },

    /**
     * Cancel an active run. Cancelled is terminal: a re-run of the demo
     * sequence starts a fresh run instead of resuming this one.
     */
    cancel(runId: string, reason?: string): CancelRunOutcome {
      const run = runs.get(runId);
      if (!run) return "RUN_NOT_FOUND";
      if (run.status !== "RUNNING" && run.status !== "FAILED") {
        return "CANCEL_NOT_ALLOWED";
      }

      const timestamp = now();
      const snapshot = buildOrchestrationSnapshot(
        deps.database,
        run.candidateId,
      );
      const plan = planRun(snapshot);
      const updated = runs.update({
        id: run.id,
        status: "CANCELLED",
        currentStepKey: plan.currentStepKey,
        safeErrorMessage: reason
          ? truncateSafeMessage(reason)
          : "Cancelled by the operator.",
        completedAt: timestamp,
        now: timestamp,
      });
      return detail(updated ?? run);
    },

    /** Run detail with a freshly derived timeline (read-only). */
    get(runId: string): RunDetailOutcome {
      const run = runs.get(runId);
      if (!run) return "RUN_NOT_FOUND";
      return detail(run);
    },

    listForCandidate(candidateId: string): OrchestrationRunResource[] {
      return runs.listForCandidate(candidateId);
    },

    /** All runs for a candidate with their timelines, newest first. */
    detailForCandidate(candidateId: string):
      | {
          readonly run: OrchestrationRunResource;
          readonly timeline: OrchestrationTimeline;
        }
      | undefined {
      const run = runs.activeForCandidate(candidateId);
      return run ? detail(run) : undefined;
    },
  };
}

export type OrchestrationService = ReturnType<
  typeof createOrchestrationService
>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the other server singletons.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: OrchestrationService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getOrchestrationService(): OrchestrationService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createOrchestrationService({
    database: connection.database,
  });
  return service;
}
