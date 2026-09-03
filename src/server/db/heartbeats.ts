import { desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "./schema";
import { workerHeartbeats } from "./schema";

type Database = BetterSQLite3Database<typeof schema>;

export interface WorkerHeartbeat {
  workerId: string;
  /** Epoch milliseconds of the worker's most recent tick. */
  observedAt: number;
}

export function recordWorkerHeartbeat(
  database: Database,
  heartbeat: WorkerHeartbeat,
): void {
  const observedAt = new Date(heartbeat.observedAt);

  database
    .insert(workerHeartbeats)
    .values({ workerId: heartbeat.workerId, observedAt })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: { observedAt },
    })
    .run();
}

export function getLatestWorkerHeartbeat(
  database: Database,
): WorkerHeartbeat | undefined {
  const row = database
    .select({
      workerId: workerHeartbeats.workerId,
      observedAt: workerHeartbeats.observedAt,
    })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.observedAt))
    .limit(1)
    .get();

  if (!row) return undefined;

  return { workerId: row.workerId, observedAt: row.observedAt.getTime() };
}
