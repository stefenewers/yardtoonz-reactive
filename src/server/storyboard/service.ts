import "server-only";

import type { StoryboardProblem } from "@/domain/storyboard";
import {
  buildCueSheet,
  buildStoryboardPlan,
  type StoryboardResource,
} from "@/domain/storyboard";
import { env } from "@/lib/env";

import type { CandidateRepository } from "@/server/candidates/repository";
import { getCandidateRepository } from "@/server/candidates/service";
import { createDatabaseProvider } from "@/server/db/client";

import { getDirectorTreatmentService } from "@/server/director/service";
import { createStoryboardRepository } from "./repository";
import type { StoryboardRepository } from "./repository";

/** The treatment reader the storyboard builder needs — nothing more. */
export type TreatmentLookup = Pick<
  ReturnType<typeof getDirectorTreatmentService>,
  "getForCandidate"
>;

export interface StoryboardServiceDeps {
  candidateRepository: CandidateRepository;
  treatmentLookup: TreatmentLookup;
  storyboardRepository: StoryboardRepository;
}

export type CreateStoryboardOutcome =
  | { outcome: "CREATED"; storyboard: StoryboardResource }
  | { outcome: "CANDIDATE_NOT_FOUND" }
  | { outcome: "TREATMENT_NOT_FOUND" }
  | { outcome: "CONSTRAINTS_VIOLATED"; problems: StoryboardProblem[] };

export function createStoryboardService(deps: StoryboardServiceDeps) {
  return {
    /**
     * Build the candidate's storyboard from its persisted Director
     * treatment. Creation is create-or-get per candidate: the treatment
     * is the only creative input, so the same treatment always yields
     * the same deterministic plan, and a repeated ask returns the
     * persisted row instead of duplicating history.
     */
    create(candidateId: string): CreateStoryboardOutcome {
      const candidate = deps.candidateRepository.get(candidateId);
      if (!candidate) return { outcome: "CANDIDATE_NOT_FOUND" };

      const existing = deps.storyboardRepository.getStoryboardForCandidate(
        candidate.id,
      );
      if (existing) return { outcome: "CREATED", storyboard: existing };

      const treatment = deps.treatmentLookup.getForCandidate(candidate.id);
      if (!treatment) return { outcome: "TREATMENT_NOT_FOUND" };

      const plan = buildStoryboardPlan(treatment.treatment, candidate.id);
      const cueOutcome = buildCueSheet(plan);
      if (!cueOutcome.ok) {
        return {
          outcome: "CONSTRAINTS_VIOLATED",
          problems: cueOutcome.problems,
        };
      }

      const storyboard = deps.storyboardRepository.createStoryboard({
        id: `sb_${candidate.id}`,
        candidateId: candidate.id,
        provider: "MOCK",
        treatmentId: treatment.id,
        plan,
        now: new Date(),
      });
      return { outcome: "CREATED", storyboard };
    },

    get(id: string): StoryboardResource | undefined {
      return deps.storyboardRepository.getStoryboard(id);
    },

    getForCandidate(candidateId: string): StoryboardResource | undefined {
      return deps.storyboardRepository.getStoryboardForCandidate(candidateId);
    },
  };
}

export type StoryboardService = ReturnType<typeof createStoryboardService>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the Director service singleton.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: StoryboardService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getStoryboardService(): StoryboardService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createStoryboardService({
    candidateRepository: getCandidateRepository(),
    treatmentLookup: getDirectorTreatmentService(),
    storyboardRepository: createStoryboardRepository(connection.database),
  });
  return service;
}
