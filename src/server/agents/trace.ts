import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type {
  AgentKey,
  AgentRunEvidence,
  AgentRunProvider,
} from "@/domain/agent-trace";
import { agentRunViewSchema, type AgentRunView } from "@/shared/agents";

import { agentRuns } from "../db/schema";
import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;
type AgentRunRow = typeof agentRuns.$inferSelect;
/**
 * Any drizzle handle that can execute statements: the database itself or an
 * open transaction, so trace rows join the writer's existing transaction
 * (candidate intake, stage completion) instead of racing it.
 */
type AgentRunExecutor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Terminal states a writer can observe; WAITING/RUNNING stay schema-only. */
export type ObservedAgentRunState = "COMPLETE" | "FAILED";

export interface NewAgentRunInput {
  readonly agentKey: AgentKey;
  readonly state: ObservedAgentRunState;
  readonly attempt?: number;
  readonly inputEvidence: AgentRunEvidence;
  readonly decision?: string;
  readonly confidence?: number;
  readonly provider?: AgentRunProvider | null;
  readonly model?: string | null;
  readonly elapsedMs?: number | null;
  readonly artifactIds?: readonly string[];
  readonly candidateId?: string | null;
  readonly productionId?: string | null;
  readonly now: Date;
}

function toView(row: AgentRunRow): AgentRunView {
  return agentRunViewSchema.parse({
    id: row.id,
    agentKey: row.agentKey,
    state: row.state,
    attempt: row.attempt,
    decision: row.decision ?? undefined,
    confidence: row.confidence ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    elapsedMs: row.elapsedMs ?? undefined,
    artifactIds: JSON.parse(row.artifactIdsJson),
    inputEvidence: JSON.parse(row.inputEvidenceJson),
    candidateId: row.candidateId ?? undefined,
    productionId: row.productionId ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

/**
 * Persist one agent run with the caller's transaction (or the database when
 * called outside one). The autoincrement id makes insertion order the
 * chronological trace order, so writers insert runs in demo-story sequence.
 */
export function insertAgentRun(
  executor: AgentRunExecutor,
  input: NewAgentRunInput,
): AgentRunView {
  const inserted = executor
    .insert(agentRuns)
    .values({
      agentKey: input.agentKey,
      state: input.state,
      attempt: input.attempt ?? 1,
      inputEvidenceJson: JSON.stringify(input.inputEvidence),
      decision: input.decision ?? null,
      confidence: input.confidence ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      elapsedMs: input.elapsedMs ?? null,
      artifactIdsJson: JSON.stringify(input.artifactIds ?? []),
      candidateId: input.candidateId ?? null,
      productionId: input.productionId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .get();

  return toView(inserted);
}

function listViews(rows: readonly AgentRunRow[]): AgentRunView[] {
  return rows.map((row) => toView(row));
}

/** Chronological runs for one candidate (insertion order). */
export function listAgentRunsByCandidate(
  database: Database,
  candidateId: string,
): AgentRunView[] {
  return listViews(
    database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.candidateId, candidateId))
      .orderBy(asc(agentRuns.id))
      .all(),
  );
}

/** Chronological runs for one production (insertion order). */
export function listAgentRunsByProduction(
  database: Database,
  productionId: string,
): AgentRunView[] {
  return listViews(
    database
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.productionId, productionId))
      .orderBy(asc(agentRuns.id))
      .all(),
  );
}
