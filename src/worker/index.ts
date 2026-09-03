import { randomUUID } from "node:crypto";

import { parseServerEnvironment } from "../lib/env-schema";
import { createLogger } from "../lib/logger";
import { getMediaToolHealth } from "../lib/media-tools";
import { openDatabase } from "../server/db/client";
import { recordWorkerHeartbeat } from "../server/db/heartbeats";
import { probeArtifactRoot } from "../server/health/artifact-root";

const logger = createLogger();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error";
}

async function runWorker(): Promise<void> {
  const environment = parseServerEnvironment(process.env);
  const workerId = randomUUID();

  let database;
  try {
    database = openDatabase(environment.DATABASE_URL);
  } catch (error: unknown) {
    logger.error("Worker failed to open the application database", {
      workerId,
      errorCode: "WORKER_DB_OPEN_FAILED",
      errorDetail: getErrorMessage(error),
    });
    process.exitCode = 1;

    return;
  }

  const artifactRootProbe = probeArtifactRoot(environment.ARTIFACT_ROOT);
  if (artifactRootProbe.diagnostic === "unwritable") {
    logger.error("Worker artifact root is not writable", {
      workerId,
      errorCode: "WORKER_ARTIFACT_ROOT_UNWRITABLE",
      errorDetail: artifactRootProbe.error,
    });
    process.exitCode = 1;

    return;
  }

  for (const tool of await getMediaToolHealth()) {
    logger.info(
      `Media tool ${tool.name} is ${tool.available ? "available" : "unavailable"}`,
      {
        workerId,
        errorCode: tool.available ? undefined : "WORKER_MEDIA_TOOL_UNAVAILABLE",
        errorDetail: tool.error,
      },
    );
  }

  const heartbeat = (): void => {
    try {
      recordWorkerHeartbeat(database.database, {
        workerId,
        observedAt: Date.now(),
      });
    } catch (error: unknown) {
      logger.error("Worker failed to record its heartbeat", {
        workerId,
        errorCode: "WORKER_HEARTBEAT_WRITE_FAILED",
        errorDetail: getErrorMessage(error),
      });
    }
  };

  heartbeat();

  const pollInterval = setInterval(heartbeat, environment.WORKER_POLL_MS);

  const stop = (): void => {
    clearInterval(pollInterval);
    logger.info("Worker stopped", { workerId });
    database.sqlite.close();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.info("Worker started; heartbeating on the poll interval", {
    workerId,
  });
}

// The production engine lands in a later phase; until then the worker's
// contract is to verify its dependencies and maintain the heartbeat the
// health endpoint observes.
runWorker().catch((error: unknown) => {
  logger.error("Worker crashed", {
    errorCode: "WORKER_CRASHED",
    errorDetail: getErrorMessage(error),
  });
  process.exitCode = 1;
});
