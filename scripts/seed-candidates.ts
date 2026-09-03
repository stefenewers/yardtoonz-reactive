import { candidateFixtures } from "../fixtures/candidates";
import { openDatabase } from "../src/server/db/client";
import { createCandidateRepository } from "../src/server/candidates/repository";

const { database, sqlite } = openDatabase();
const repository = createCandidateRepository(database);
const seeded = repository.seed(candidateFixtures, new Date().toISOString());
sqlite.close();
console.log(`Seeded ${seeded} candidate fixtures.`);
