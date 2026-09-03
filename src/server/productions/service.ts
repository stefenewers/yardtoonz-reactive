import "server-only";

import {
  createLocalArtifactStore,
  type ArtifactStore,
} from "@/lib/artifact-store";
import { env } from "@/lib/env";
import { openDatabase } from "@/server/db/client";

import { createProductionRepository } from "./repository";
import { createProductionWorkerRepository } from "./worker-repository";

type ProductionRepository = ReturnType<typeof createProductionRepository>;

let repository: ProductionRepository | undefined;
let artifactStore: ArtifactStore | undefined;

export function getProductionRepository(): ProductionRepository {
  if (repository) return repository;

  const { database } = openDatabase(env.DATABASE_URL);
  repository = createProductionRepository(database);
  return repository;
}

export function getProductionArtifactStore(): ArtifactStore {
  if (artifactStore) return artifactStore;

  artifactStore = createLocalArtifactStore();
  return artifactStore;
}

let workerRepository:
  | ReturnType<typeof createProductionWorkerRepository>
  | undefined;

/**
 * Worker-pipeline persistence (stage leases, attempts, retry verification).
 * Shares the application database with the API-side production repository.
 */
export function getProductionWorkerRepository(): ReturnType<
  typeof createProductionWorkerRepository
> {
  if (workerRepository) return workerRepository;

  const { database } = openDatabase(env.DATABASE_URL);
  workerRepository = createProductionWorkerRepository(
    database,
    getProductionArtifactStore(),
  );
  return workerRepository;
}
