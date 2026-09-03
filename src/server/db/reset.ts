import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { candidateFixtures } from "../../../fixtures/candidates";
import type { ServerEnvironment } from "../../lib/env-schema";
import { createCandidateRepository } from "../candidates/repository";
import { openDatabase, resolveSqliteFilename } from "./client";

export interface ResetDemoDataOptions {
  migrationsFolder?: string;
  now?: string;
  workingDirectory?: string;
}

export interface ResetDemoDataResult {
  databaseFile: string;
  artifactRoot: string;
  seededCandidates: number;
}

function resolveOwnedPath(
  configuredPath: string,
  workingDirectory: string,
  label: string,
): string {
  const resolved = path.resolve(workingDirectory, configuredPath);
  const relative = path.relative(workingDirectory, resolved);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must stay inside the application directory`);
  }
  return resolved;
}

export async function resetDemoData(
  environment: Pick<ServerEnvironment, "DATABASE_URL" | "ARTIFACT_ROOT">,
  options: ResetDemoDataOptions = {},
): Promise<ResetDemoDataResult> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const databaseFile = resolveSqliteFilename(
    environment.DATABASE_URL,
    workingDirectory,
  );
  if (databaseFile === ":memory:") {
    throw new Error("Demo reset requires a persistent SQLite database file");
  }
  resolveOwnedPath(databaseFile, workingDirectory, "DATABASE_URL");
  const artifactRoot = resolveOwnedPath(
    environment.ARTIFACT_ROOT,
    workingDirectory,
    "ARTIFACT_ROOT",
  );

  await Promise.all([
    rm(databaseFile, { force: true }),
    rm(`${databaseFile}-shm`, { force: true }),
    rm(`${databaseFile}-wal`, { force: true }),
    rm(artifactRoot, { force: true, recursive: true }),
  ]);
  await mkdir(artifactRoot, { recursive: true });

  const connection = openDatabase(environment.DATABASE_URL, {
    migrationsFolder: options.migrationsFolder,
    workingDirectory,
  });
  try {
    const seededCandidates = createCandidateRepository(
      connection.database,
    ).seed(candidateFixtures, options.now ?? new Date().toISOString());
    return { databaseFile, artifactRoot, seededCandidates };
  } finally {
    connection.sqlite.close();
  }
}
