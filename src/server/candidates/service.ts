import "server-only";

import { candidateFixtures } from "@/../fixtures/candidates";
import { openDatabase } from "@/server/db/client";

import { createCandidateRepository } from "./repository";

let repository: ReturnType<typeof createCandidateRepository> | undefined;

export function getCandidateRepository(): ReturnType<
  typeof createCandidateRepository
> {
  if (repository) return repository;

  const { database } = openDatabase();
  repository = createCandidateRepository(database);
  repository.seed(candidateFixtures, new Date().toISOString());
  return repository;
}
