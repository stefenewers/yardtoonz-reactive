import "server-only";

import { env } from "@/lib/env";
import type { ServerEnvironment } from "@/lib/env-schema";
import {
  classifyWorkerHeartbeat,
  createPublicHealthReport,
  deriveWorkerHeartbeatStaleAfterMs,
  type PublicHealthReport,
} from "@/lib/health-report";
import { getMediaToolHealth } from "@/lib/media-tools";
import {
  openDatabase,
  resolveSqliteFilename,
  type DatabaseConnection,
} from "@/server/db/client";
import { getLatestWorkerHeartbeat } from "@/server/db/heartbeats";

import { probeArtifactRoot } from "./artifact-root";
import { probeDatabase, type DatabaseProbe } from "./database";

export interface CollectHealthReportOptions {
  environment?: Pick<
    ServerEnvironment,
    | "DATABASE_URL"
    | "ARTIFACT_ROOT"
    | "IMAGE_PROVIDER"
    | "ANIMATION_PROVIDER"
    | "WORKER_POLL_MS"
  >;
  /** Injected connection skips opening; used by tests and callers that own one. */
  connection?: DatabaseConnection;
  workingDirectory?: string;
  migrationsFolder?: string;
  now?: Date;
}

function openHealthConnection(
  databaseUrl: string,
  workingDirectory: string,
  migrationsFolder?: string,
): { connection?: DatabaseConnection; probe: DatabaseProbe } {
  try {
    const connection = openDatabase(databaseUrl, {
      workingDirectory,
      migrationsFolder,
    });
    // Cache only in-memory databases: their data lives in the connection, so
    // caching is required for reports to share state. File-backed databases
    // open fresh per report like every other service — demo:reset can replace
    // the file under a live server, and a cached handle would keep reading
    // the deleted inode's stale rows.
    if (resolveSqliteFilename(databaseUrl, workingDirectory) === ":memory:") {
      cachedConnection = connection;
    }

    return { connection, probe: probeDatabase(connection.database) };
  } catch (error: unknown) {
    // A failed open is not cached so the next request can recover after the
    // operator fixes the database.
    return {
      probe: {
        diagnostic: "unavailable",
        error:
          error instanceof Error ? error.message : "Unknown database error",
      },
    };
  }
}

let cachedConnection: DatabaseConnection | undefined;

/**
 * Runs every health probe and returns the public report. Probe internals
 * (paths, errors, versions) stay here; the public report carries only bounded
 * diagnostic categories.
 */
export async function collectHealthReport(
  options: CollectHealthReportOptions = {},
): Promise<PublicHealthReport> {
  const environment = options.environment ?? env;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const now = options.now ?? new Date();

  let activeConnection = options.connection ?? cachedConnection;
  let databaseProbe: DatabaseProbe;

  if (activeConnection) {
    databaseProbe = probeDatabase(activeConnection.database);
  } else {
    const opened = openHealthConnection(
      environment.DATABASE_URL,
      workingDirectory,
      options.migrationsFolder,
    );
    activeConnection = opened.connection;
    databaseProbe = opened.probe;
  }

  let workerHeartbeatObservedAtMs: number | undefined;
  if (activeConnection && databaseProbe.diagnostic === "available") {
    workerHeartbeatObservedAtMs = getLatestWorkerHeartbeat(
      activeConnection.database,
    )?.observedAt;
  }

  const artifactRootProbe = probeArtifactRoot(
    environment.ARTIFACT_ROOT,
    workingDirectory,
  );
  const mediaTools = await getMediaToolHealth();

  return createPublicHealthReport(environment, {
    database: databaseProbe.diagnostic,
    artifactRoot: artifactRootProbe.diagnostic,
    mediaTools,
    worker: classifyWorkerHeartbeat(
      workerHeartbeatObservedAtMs,
      now.getTime(),
      deriveWorkerHeartbeatStaleAfterMs(environment.WORKER_POLL_MS),
    ),
  });
}
