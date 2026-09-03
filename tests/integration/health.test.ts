import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { workerHeartbeatStaleAfterMs } from "../../src/lib/health-report";
import type { ServerEnvironment } from "../../src/lib/env-schema";
import {
  openDatabase,
  type DatabaseConnection,
} from "../../src/server/db/client";
import {
  getLatestWorkerHeartbeat,
  recordWorkerHeartbeat,
} from "../../src/server/db/heartbeats";
import { probeArtifactRoot } from "../../src/server/health/artifact-root";
import { probeDatabase } from "../../src/server/health/database";
import { collectHealthReport } from "../../src/server/health/service";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
const temporaryDirectories: string[] = [];
const openConnections: DatabaseConnection[] = [];

afterEach(async () => {
  for (const connection of openConnections.splice(0)) {
    if (connection.sqlite.open) connection.sqlite.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "yardtoonz-health-"));
  temporaryDirectories.push(directory);

  return directory;
}

async function openFreshDatabase(): Promise<DatabaseConnection> {
  const workingDirectory = await createTemporaryDirectory();
  const connection = openDatabase("file:./state/yardtoonz.db", {
    migrationsFolder,
    workingDirectory,
  });
  openConnections.push(connection);

  return connection;
}

function healthEnvironment(
  artifactRoot: string,
): Pick<
  ServerEnvironment,
  | "DATABASE_URL"
  | "ARTIFACT_ROOT"
  | "IMAGE_PROVIDER"
  | "ANIMATION_PROVIDER"
  | "WORKER_POLL_MS"
> {
  return {
    DATABASE_URL: "file:./unused/health.db",
    ARTIFACT_ROOT: artifactRoot,
    IMAGE_PROVIDER: "MOCK",
    ANIMATION_PROVIDER: "MOCK",
    WORKER_POLL_MS: 1000,
  };
}

describe("worker heartbeat records", () => {
  it("starts empty and returns undefined", async () => {
    const connection = await openFreshDatabase();

    expect(getLatestWorkerHeartbeat(connection.database)).toBeUndefined();
  });

  it("upserts per worker and returns the latest observed tick", async () => {
    const connection = await openFreshDatabase();

    recordWorkerHeartbeat(connection.database, {
      workerId: "worker-a",
      observedAt: 1_000,
    });
    recordWorkerHeartbeat(connection.database, {
      workerId: "worker-a",
      observedAt: 2_000,
    });
    recordWorkerHeartbeat(connection.database, {
      workerId: "worker-b",
      observedAt: 1_500,
    });

    expect(getLatestWorkerHeartbeat(connection.database)).toEqual({
      workerId: "worker-a",
      observedAt: 2_000,
    });
  });
});

describe("probeDatabase", () => {
  it("reports available for a working connection", async () => {
    const connection = await openFreshDatabase();

    expect(probeDatabase(connection.database)).toEqual({
      diagnostic: "available",
    });
  });

  it("reports unavailable with internal detail for a broken connection", async () => {
    const connection = await openFreshDatabase();
    connection.sqlite.close();

    const probe = probeDatabase(connection.database);

    expect(probe.diagnostic).toBe("unavailable");
    expect(probe.error).toBeTruthy();
  });
});

describe("probeArtifactRoot", () => {
  it("creates the directory, probes it, and leaves no probe files", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const probe = probeArtifactRoot("./artifacts", workingDirectory);

    expect(probe.diagnostic).toBe("writable");
    expect(await readdir(path.join(workingDirectory, "artifacts"))).toEqual([]);
  });

  it("reports unwritable when the root path is a regular file", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const blockFile = path.join(workingDirectory, "occupied");
    await mkdir(path.dirname(blockFile), { recursive: true });
    await writeFile(blockFile, "not a directory");

    const probe = probeArtifactRoot("occupied", workingDirectory);

    expect(probe.diagnostic).toBe("unwritable");
    expect(probe.error).toBeTruthy();
  });
});

describe("collectHealthReport", () => {
  it("reports every check with bounded categories and no internals", async () => {
    const connection = await openFreshDatabase();
    const workingDirectory = await createTemporaryDirectory();
    recordWorkerHeartbeat(connection.database, {
      workerId: "worker-a",
      observedAt: Date.now(),
    });

    const report = await collectHealthReport({
      environment: healthEnvironment("./artifacts"),
      connection,
      workingDirectory,
    });

    expect(report).toMatchObject({
      status: "ok",
      providers: { image: "MOCK", animation: "MOCK" },
      checks: {
        database: { diagnostic: "available" },
        artifactRoot: { diagnostic: "writable" },
        worker: { diagnostic: "fresh" },
      },
    });
    expect(report.checks.mediaTools).toHaveLength(2);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('"path"');
    expect(serialized).not.toContain('"error"');
    expect(serialized).not.toContain('"version"');
    expect(serialized).not.toContain('"observedAt"');
    expect(serialized).not.toContain(workingDirectory);
  });

  it("reports a stale heartbeat without degrading the aggregate", async () => {
    const connection = await openFreshDatabase();
    const workingDirectory = await createTemporaryDirectory();
    recordWorkerHeartbeat(connection.database, {
      workerId: "worker-a",
      observedAt: Date.now() - workerHeartbeatStaleAfterMs - 1,
    });

    const report = await collectHealthReport({
      environment: healthEnvironment("./artifacts"),
      connection,
      workingDirectory,
    });

    expect(report.checks.worker).toEqual({ diagnostic: "stale" });
    expect(report.status).toBe("ok");
  });

  it("reports an unknown worker when no heartbeat exists", async () => {
    const connection = await openFreshDatabase();
    const workingDirectory = await createTemporaryDirectory();

    const report = await collectHealthReport({
      environment: healthEnvironment("./artifacts"),
      connection,
      workingDirectory,
    });

    expect(report.checks.worker).toEqual({ diagnostic: "unknown" });
  });

  it("reports an unavailable database and unknown worker for a broken connection", async () => {
    const connection = await openFreshDatabase();
    const workingDirectory = await createTemporaryDirectory();
    connection.sqlite.close();

    const report = await collectHealthReport({
      environment: healthEnvironment("./artifacts"),
      connection,
      workingDirectory,
    });

    expect(report.checks.database).toEqual({ diagnostic: "unavailable" });
    expect(report.checks.worker).toEqual({ diagnostic: "unknown" });
    expect(report.status).toBe("degraded");
  });

  it("opens the database from the injected environment when none is injected", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const report = await collectHealthReport({
      environment: healthEnvironment("./artifacts"),
      workingDirectory,
      migrationsFolder,
    });

    expect(report.checks.database).toEqual({ diagnostic: "available" });
    expect(report.checks.worker).toEqual({ diagnostic: "unknown" });
  });
});
