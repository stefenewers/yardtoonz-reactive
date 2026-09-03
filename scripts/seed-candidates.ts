import { candidateFixtures } from "../fixtures/candidates";
import { parseServerEnvironment } from "../src/lib/env-schema";
import { openDatabase } from "../src/server/db/client";
import { createCandidateRepository } from "../src/server/candidates/repository";

const environment = parseServerEnvironment(process.env);
const { database, sqlite } = openDatabase(environment.DATABASE_URL);
const repository = createCandidateRepository(database);
const seeded = repository.seed(candidateFixtures, new Date().toISOString());
sqlite.close();
console.log(`Seeded ${seeded} candidate fixtures.`);
