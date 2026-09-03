import { parseServerEnvironment } from "../src/lib/env-schema";
import { resetDemoData } from "../src/server/db/reset";

const environment = parseServerEnvironment(process.env);
const result = await resetDemoData(environment);
console.log(
  `Reset ${result.databaseFile}, cleared ${result.artifactRoot}, and seeded ${result.seededCandidates} candidate fixtures.`,
);
