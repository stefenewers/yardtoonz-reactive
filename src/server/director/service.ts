import "server-only";

import { buildMockDirectorTreatment } from "@/domain/director";
import type {
  CreateDirectorTreatmentRequest,
  DirectorTreatmentResource,
} from "@/domain/director";
import { env } from "@/lib/env";

import type { CandidateRepository } from "@/server/candidates/repository";
import { getCandidateRepository } from "@/server/candidates/service";
import { createDatabaseProvider } from "@/server/db/client";

import { createDirectorTreatmentRepository } from "./repository";
import type { DirectorTreatmentRepository } from "./repository";

export interface DirectorTreatmentServiceDeps {
  candidateRepository: CandidateRepository;
  treatmentRepository: DirectorTreatmentRepository;
}

export function createDirectorTreatmentService(
  deps: DirectorTreatmentServiceDeps,
) {
  return {
    /**
     * Ask the Director for a treatment. The candidate's persisted evidence
     * (caption, metrics, comment excerpts, adaptation note) is loaded
     * server-side so quotes always come from received data; optional
     * transcript, source metadata, keyframes, and creative direction ride
     * on the request. Creation is idempotent per candidate.
     */
    create(
      request: CreateDirectorTreatmentRequest,
    ): DirectorTreatmentResource | "CANDIDATE_NOT_FOUND" {
      const candidate = deps.candidateRepository.get(request.candidateId);
      if (!candidate) return "CANDIDATE_NOT_FOUND";

      const existing = deps.treatmentRepository.getTreatmentForCandidate(
        candidate.id,
      );
      if (existing) return existing;

      const treatment = buildMockDirectorTreatment({
        candidateId: candidate.id,
        caption: candidate.caption,
        metrics: candidate.metrics,
        commentExcerpts: candidate.commentExcerpts,
        adaptationNote: candidate.adaptationNote,
        transcript: request.transcript,
        sourceVideoMetadata: request.sourceVideoMetadata,
        keyframes: request.keyframes,
        creativeDirection: request.creativeDirection,
      });

      return deps.treatmentRepository.createTreatment({
        id: `treat_${candidate.id}`,
        candidateId: candidate.id,
        provider: "MOCK",
        treatment,
        now: new Date(),
      });
    },

    get(id: string): DirectorTreatmentResource | undefined {
      return deps.treatmentRepository.getTreatment(id);
    },

    getForCandidate(
      candidateId: string,
    ): DirectorTreatmentResource | undefined {
      return deps.treatmentRepository.getTreatmentForCandidate(candidateId);
    },
  };
}

export type DirectorTreatmentService = ReturnType<
  typeof createDirectorTreatmentService
>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the candidate service singleton.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: DirectorTreatmentService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getDirectorTreatmentService(): DirectorTreatmentService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createDirectorTreatmentService({
    candidateRepository: getCandidateRepository(),
    treatmentRepository: createDirectorTreatmentRepository(connection.database),
  });
  return service;
}
