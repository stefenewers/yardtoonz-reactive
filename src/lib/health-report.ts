import type { ServerEnvironment } from "./env-schema";
import type {
  MediaToolDiagnostic,
  MediaToolName,
  MediaToolStatus,
} from "./media-tools";

export type DatabaseHealthDiagnostic = "available" | "unavailable";
export type ArtifactRootHealthDiagnostic = "writable" | "unwritable";
export type WorkerHeartbeatDiagnostic = "fresh" | "stale" | "unknown";

/**
 * A heartbeat older than this window is stale even when the poll interval is
 * short. The window also scales with the configured worker poll interval so a
 * slow worker is not reported stale while it is still ticking.
 */
export const workerHeartbeatStaleAfterMs = 30_000;

export function deriveWorkerHeartbeatStaleAfterMs(
  workerPollMs: number,
): number {
  return Math.max(workerHeartbeatStaleAfterMs, workerPollMs * 30);
}

export function classifyWorkerHeartbeat(
  latestObservedAtMs: number | undefined,
  nowMs: number,
  staleAfterMs: number,
): WorkerHeartbeatDiagnostic {
  if (latestObservedAtMs === undefined) return "unknown";
  return nowMs - latestObservedAtMs <= staleAfterMs ? "fresh" : "stale";
}

interface PublicMediaToolStatus {
  name: MediaToolName;
  available: boolean;
  diagnostic: MediaToolDiagnostic;
}

export interface PublicHealthReport {
  status: "ok" | "degraded";
  providers: {
    image: ServerEnvironment["IMAGE_PROVIDER"];
    animation: ServerEnvironment["ANIMATION_PROVIDER"];
  };
  checks: {
    database: { diagnostic: DatabaseHealthDiagnostic };
    artifactRoot: { diagnostic: ArtifactRootHealthDiagnostic };
    mediaTools: PublicMediaToolStatus[];
    worker: { diagnostic: WorkerHeartbeatDiagnostic };
  };
}

export interface HealthCheckResults {
  database: DatabaseHealthDiagnostic;
  artifactRoot: ArtifactRootHealthDiagnostic;
  mediaTools: MediaToolStatus[];
  worker: WorkerHeartbeatDiagnostic;
}

function toPublicMediaToolStatus(
  status: MediaToolStatus,
): PublicMediaToolStatus {
  return {
    name: status.name,
    available: status.available,
    diagnostic: status.diagnostic,
  };
}

export function createPublicHealthReport(
  environment: Pick<ServerEnvironment, "IMAGE_PROVIDER" | "ANIMATION_PROVIDER">,
  checks: HealthCheckResults,
): PublicHealthReport {
  // The worker heartbeat is observational: it reports the worker's liveness
  // category without degrading the aggregate. A worker that never reported is
  // normal for web-only sessions and CI, and a stale heartbeat would
  // otherwise pin every local re-run of the browser smoke test (which uses
  // this endpoint as its readiness probe) to a 503 until the local database
  // is reset. The "stale" category itself is the operator's signal.
  const degraded =
    checks.database === "unavailable" ||
    checks.artifactRoot === "unwritable" ||
    checks.mediaTools.some((tool) => !tool.available);

  return {
    status: degraded ? "degraded" : "ok",
    providers: {
      image: environment.IMAGE_PROVIDER,
      animation: environment.ANIMATION_PROVIDER,
    },
    checks: {
      database: { diagnostic: checks.database },
      artifactRoot: { diagnostic: checks.artifactRoot },
      mediaTools: checks.mediaTools.map(toPublicMediaToolStatus),
      worker: { diagnostic: checks.worker },
    },
  };
}
