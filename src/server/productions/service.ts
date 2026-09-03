import "server-only";

import {
  createLocalArtifactStore,
  type ArtifactStore,
} from "@/lib/artifact-store";
import { env } from "@/lib/env";
import {
  createDatabaseProvider,
  type DatabaseConnection,
} from "@/server/db/client";

import { createProductionRepository } from "./repository";
import { createProductionWorkerRepository } from "./worker-repository";

type ProductionRepository = ReturnType<typeof createProductionRepository>;

// `demo:reset` replaces the database file between rehearsal runs; the provider
// reopens the connection so a running web server never serves pre-reset rows.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let repository: ProductionRepository | undefined;
let repositoryConnection: DatabaseConnection | undefined;
let artifactStore: ArtifactStore | undefined;

export function getProductionRepository(): ProductionRepository {
  const connection = databaseProvider.getConnection();
  if (repository && repositoryConnection === connection) return repository;

  repositoryConnection = connection;
  repository = createProductionRepository(connection.database);
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
let workerRepositoryConnection: DatabaseConnection | undefined;

/**
 * Worker-pipeline persistence (stage leases, attempts, retry verification).
 * Shares the application database with the API-side production repository.
 */
export function getProductionWorkerRepository(): ReturnType<
  typeof createProductionWorkerRepository
> {
  const connection = databaseProvider.getConnection();
  if (workerRepository && workerRepositoryConnection === connection) {
    return workerRepository;
  }

  workerRepositoryConnection = connection;
  workerRepository = createProductionWorkerRepository(
    connection.database,
    getProductionArtifactStore(),
  );
  return workerRepository;
}
