import "server-only";

import {
  createLocalArtifactStore,
  type ArtifactStore,
} from "@/lib/artifact-store";
import { env } from "@/lib/env";
import { openDatabase } from "@/server/db/client";

import { createProductionRepository } from "./repository";

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
