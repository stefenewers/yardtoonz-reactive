import "server-only";

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { env } from "@/lib/env";
import type { ServerEnvironment } from "@/lib/env-schema";
import { createDatabaseProvider } from "@/server/db/client";
import {
  diagnosticsCredentialSettings,
  diagnosticsResponseSchema,
  type DiagnosticsResponse,
} from "@/shared/diagnostics";

import type * as schema from "../db/schema";
import { createProductionRepository } from "../productions/repository";

type Database = BetterSQLite3Database<typeof schema>;

/**
 * Read-only aggregation behind the diagnostics surface: every persisted
 * production (newest first, with stages and artifacts) plus the VALIDATED
 * environment's credential PRESENCE booleans. Secret values never enter the
 * snapshot — the mapping projects them to booleans before the schema sees
 * the payload, so leak and render are structurally independent.
 */
export function createDiagnosticsService(
  database: Database,
  environment: ServerEnvironment,
) {
  const productions = createProductionRepository(database);

  function credentialPresence(): Record<
    (typeof diagnosticsCredentialSettings)[number],
    boolean
  > {
    const values: Record<string, string | undefined> = {
      OPENAI_API_KEY: environment.OPENAI_API_KEY,
      OPENAI_IMAGE_MODEL: environment.OPENAI_IMAGE_MODEL,
      OPENAI_DIRECTOR_MODEL: environment.OPENAI_DIRECTOR_MODEL,
      RUNWAY_API_KEY: environment.RUNWAY_API_KEY,
      RUNWAY_MODEL: environment.RUNWAY_MODEL,
    };

    return Object.fromEntries(
      diagnosticsCredentialSettings.map((setting) => [
        setting,
        Boolean(values[setting]?.trim()),
      ]),
    ) as Record<(typeof diagnosticsCredentialSettings)[number], boolean>;
  }

  return {
    /** Bounded diagnostics snapshot; schema-parsed so drift fails closed. */
    getSnapshot(): DiagnosticsResponse {
      return diagnosticsResponseSchema.parse({
        environment: {
          imageProvider: environment.IMAGE_PROVIDER,
          animationProvider: environment.ANIMATION_PROVIDER,
          directorProvider: environment.DIRECTOR_PROVIDER,
          credentials: credentialPresence(),
        },
        jobs: productions.listAll().map((detail) => ({
          id: detail.production.id,
          candidateId: detail.production.candidateId,
          status: detail.production.status,
          imageProvider: detail.production.imageProvider,
          animationProvider: detail.production.animationProvider,
          attempt: detail.production.attempt,
          createdAt: detail.production.createdAt,
          updatedAt: detail.production.updatedAt,
          stages: detail.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            status: stage.status,
            attempt: stage.attempt,
            startedAt: stage.startedAt,
            completedAt: stage.completedAt,
            providerRequestId: stage.providerRequestId,
          })),
          artifacts: detail.artifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            provider: artifact.provider,
            providerRequestId: artifact.providerRequestId,
            createdAt: artifact.createdAt,
          })),
        })),
      });
    },
  };
}

export type DiagnosticsService = ReturnType<typeof createDiagnosticsService>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the other server singletons.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: DiagnosticsService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

/** Process-wide singleton bound to the current database connection. */
export function getDiagnosticsService(): DiagnosticsService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createDiagnosticsService(connection.database, env);
  return service;
}
