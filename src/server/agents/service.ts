import "server-only";

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { AgentRunView } from "@/shared/agents";
import { env } from "@/lib/env";

import { createDatabaseProvider } from "@/server/db/client";
import { candidates, productions } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";

import { listAgentRunsByCandidate, listAgentRunsByProduction } from "./trace";

type Database = BetterSQLite3Database<typeof schema>;

export type AgentTraceOutcome =
  | { readonly runs: readonly AgentRunView[] }
  | "CANDIDATE_NOT_FOUND"
  | "PRODUCTION_NOT_FOUND";

export function createAgentTraceService(database: Database) {
  return {
    /** Chronological runs for a candidate; 404-mapped when it does not exist. */
    listForCandidate(candidateId: string): AgentTraceOutcome {
      const exists = database
        .select({ id: candidates.id })
        .from(candidates)
        .where(eq(candidates.id, candidateId))
        .get();
      if (!exists) return "CANDIDATE_NOT_FOUND";

      return { runs: listAgentRunsByCandidate(database, candidateId) };
    },

    /** Chronological runs for a production; 404-mapped when it does not exist. */
    listForProduction(productionId: string): AgentTraceOutcome {
      const exists = database
        .select({ id: productions.id })
        .from(productions)
        .where(eq(productions.id, productionId))
        .get();
      if (!exists) return "PRODUCTION_NOT_FOUND";

      return { runs: listAgentRunsByProduction(database, productionId) };
    },
  };
}

export type AgentTraceService = ReturnType<typeof createAgentTraceService>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the other server singletons.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: AgentTraceService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getAgentTraceService(): AgentTraceService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createAgentTraceService(connection.database);
  return service;
}
