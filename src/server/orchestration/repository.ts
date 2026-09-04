import { and, desc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";

import type { AgentKey } from "@/domain/agent-trace";
import type { OrchestrationRunResource } from "@/shared/orchestration";
import type { OrchestrationRunStatus } from "@/shared/orchestration";

import { orchestrationRuns } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type RunRow = typeof orchestrationRuns.$inferSelect;

export const activeRunStatuses = ["RUNNING", "FAILED"] as const;
export const terminalRunStatuses = ["COMPLETE", "CANCELLED"] as const;

export interface CreateRunInput {
  readonly candidateId: string;
  readonly currentStepKey: AgentKey | null;
  readonly now: Date;
}

export interface UpdateRunInput {
  readonly id: string;
  readonly status?: OrchestrationRunStatus;
  readonly currentStepKey?: AgentKey | null;
  readonly errorCode?: string | null;
  readonly safeErrorMessage?: string | null;
  readonly completedAt?: Date | null;
  readonly now: Date;
}

function toResource(row: RunRow): OrchestrationRunResource {
  return {
    id: row.id,
    candidateId: row.candidateId,
    status: row.status,
    currentStepKey: row.currentStepKey ?? null,
    errorCode: row.errorCode ?? null,
    safeErrorMessage: row.safeErrorMessage ?? null,
    startedAt: new Date(row.startedAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    completedAt: row.completedAt
      ? new Date(row.completedAt).toISOString()
      : null,
  };
}

/**
 * orchestration_runs persistence: identity and human intent only. Step
 * progress is derived from agent_runs at read time, so this table never
 * duplicates cursor state the trace already owns.
 */
export function createOrchestrationRunRepository(database: Database) {
  return {
    create(input: CreateRunInput): OrchestrationRunResource {
      const inserted = database
        .insert(orchestrationRuns)
        .values({
          id: `orun_${randomUUID()}`,
          candidateId: input.candidateId,
          status: "RUNNING",
          currentStepKey: input.currentStepKey,
          startedAt: input.now,
          updatedAt: input.now,
        })
        .returning()
        .get();
      return toResource(inserted);
    },

    get(id: string): OrchestrationRunResource | undefined {
      const row = database
        .select()
        .from(orchestrationRuns)
        .where(eq(orchestrationRuns.id, id))
        .get();
      return row ? toResource(row) : undefined;
    },

    /** The single active (RUNNING or FAILED) run for a candidate, if any. */
    activeForCandidate(
      candidateId: string,
    ): OrchestrationRunResource | undefined {
      const row = database
        .select()
        .from(orchestrationRuns)
        .where(
          and(
            eq(orchestrationRuns.candidateId, candidateId),
            inArray(orchestrationRuns.status, [...activeRunStatuses]),
          ),
        )
        .orderBy(desc(orchestrationRuns.startedAt))
        .get();
      return row ? toResource(row) : undefined;
    },

    listForCandidate(candidateId: string): OrchestrationRunResource[] {
      return database
        .select()
        .from(orchestrationRuns)
        .where(eq(orchestrationRuns.candidateId, candidateId))
        .orderBy(desc(orchestrationRuns.startedAt), desc(orchestrationRuns.id))
        .all()
        .map(toResource);
    },

    update(input: UpdateRunInput): OrchestrationRunResource | undefined {
      const updated = database
        .update(orchestrationRuns)
        .set({
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.currentStepKey === undefined
            ? {}
            : { currentStepKey: input.currentStepKey }),
          ...(input.errorCode === undefined
            ? {}
            : { errorCode: input.errorCode }),
          ...(input.safeErrorMessage === undefined
            ? {}
            : { safeErrorMessage: input.safeErrorMessage }),
          ...(input.completedAt === undefined
            ? {}
            : { completedAt: input.completedAt }),
          updatedAt: input.now,
        })
        .where(eq(orchestrationRuns.id, input.id))
        .returning()
        .get();
      return updated ? toResource(updated) : undefined;
    },
  };
}

export type OrchestrationRunRepository = ReturnType<
  typeof createOrchestrationRunRepository
>;
