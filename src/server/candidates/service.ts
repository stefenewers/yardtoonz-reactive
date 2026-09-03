import "server-only";

import { candidateFixtures } from "@/../fixtures/candidates";
import { env } from "@/lib/env";
import {
  createDatabaseProvider,
  type DatabaseConnection,
} from "@/server/db/client";

import { createCandidateRepository } from "./repository";

// `demo:reset` replaces the database file between rehearsal runs; the provider
// reopens the connection so a running web server never serves pre-reset rows.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let repository: ReturnType<typeof createCandidateRepository> | undefined;
let cachedConnection: DatabaseConnection | undefined;

export function getCandidateRepository(): ReturnType<
  typeof createCandidateRepository
> {
  const connection = databaseProvider.getConnection();
  if (repository && cachedConnection === connection) return repository;

  cachedConnection = connection;
  repository = createCandidateRepository(connection.database);
  repository.seed(candidateFixtures, new Date().toISOString());
  return repository;
}
