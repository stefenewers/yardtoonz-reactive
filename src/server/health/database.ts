import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "../db/schema";

type Database = BetterSQLite3Database<typeof schema>;

export type DatabaseHealthDiagnostic = "available" | "unavailable";

export interface DatabaseProbe {
  diagnostic: DatabaseHealthDiagnostic;
  /** Internal failure detail for server-side logs; never serialized publicly. */
  error?: string;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown database error";
}

export function probeDatabase(database: Database): DatabaseProbe {
  try {
    database.run(sql`SELECT 1`);

    return { diagnostic: "available" };
  } catch (error: unknown) {
    return { diagnostic: "unavailable", error: getErrorMessage(error) };
  }
}
