import "server-only";

import {
  buildMockDirectorTreatment,
  mockDirectorModelLabel,
} from "@/domain/director";
import type {
  CreateDirectorTreatmentRequest,
  DirectorTreatmentResource,
} from "@/domain/director";
import { directorTreatmentInputSchema } from "@/domain/director";
import { env } from "@/lib/env";
import type { DirectorProvider } from "@/lib/providers";
import {
  OpenAIDirectorAdapterError,
  createOpenAIDirectorTreatmentProvider,
  resolveOpenAIDirectorAdapterConfig,
  type OpenAIDirectorTreatmentProvider,
  type OpenAIDirectorTreatmentResult,
} from "@/lib/openai-director-adapter";

import type { CandidateRepository } from "@/server/candidates/repository";
import { getCandidateRepository } from "@/server/candidates/service";
import { createDatabaseProvider } from "@/server/db/client";

import { createDirectorTreatmentRepository } from "./repository";
import type { DirectorTreatmentRepository } from "./repository";

/**
 * Typed failures the Director API maps to stable error codes. LIVE runs
 * whose remote outcome is unknown carry the provider request ID so callers
 * can reconcile; the service never re-submits a paid call on its own.
 */
export type DirectorTreatmentErrorCode =
  | "TREATMENT_UNRESOLVED"
  | "PROVIDER_REQUEST_FAILED";

export class DirectorTreatmentError extends Error {
  constructor(
    public readonly code: DirectorTreatmentErrorCode,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

function translateAdapterError(error: unknown): unknown {
  if (!(error instanceof OpenAIDirectorAdapterError)) return error;
  if (error.code === "PROVIDER_REQUEST_UNRESOLVED") {
    return new DirectorTreatmentError(
      "TREATMENT_UNRESOLVED",
      error.message,
      error.requestId,
    );
  }
  return new DirectorTreatmentError("PROVIDER_REQUEST_FAILED", error.message);
}

export interface DirectorTreatmentServiceDeps {
  candidateRepository: CandidateRepository;
  treatmentRepository: DirectorTreatmentRepository;
  /** Provider attribution for newly created treatments; defaults to MOCK. */
  selection?: DirectorProvider;
  /** Constructed LIVE provider; required when selection is "OPENAI". */
  liveProvider?: OpenAIDirectorTreatmentProvider;
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
     * on the request. Creation is idempotent per candidate: the persisted
     * treatment is create-or-get, and LIVE mode additionally runs at most
     * one paid call per input fingerprint (UNCERTAIN fingerprints refuse
     * re-submission until a human reconciles them by request ID).
     */
    async create(
      request: CreateDirectorTreatmentRequest,
    ): Promise<DirectorTreatmentResource | "CANDIDATE_NOT_FOUND"> {
      const candidate = deps.candidateRepository.get(request.candidateId);
      if (!candidate) return "CANDIDATE_NOT_FOUND";

      const existing = deps.treatmentRepository.getTreatmentForCandidate(
        candidate.id,
      );
      if (existing) return existing;

      const treatmentInput = directorTreatmentInputSchema.parse({
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

      if ((deps.selection ?? "MOCK") === "OPENAI") {
        const liveProvider = deps.liveProvider;
        if (!liveProvider) {
          throw new DirectorTreatmentError(
            "PROVIDER_REQUEST_FAILED",
            "The Director LIVE provider is not constructed; check DIRECTOR_PROVIDER configuration.",
          );
        }

        let result: OpenAIDirectorTreatmentResult;
        try {
          result = await liveProvider.treat({
            candidateId: candidate.id,
            input: treatmentInput,
          });
        } catch (error) {
          throw translateAdapterError(error);
        }

        return deps.treatmentRepository.createTreatment({
          id: `treat_${candidate.id}`,
          candidateId: candidate.id,
          provider: "OPENAI",
          model: result.model,
          providerRequestId: result.requestId ?? null,
          treatment: result.treatment,
          now: new Date(),
        });
      }

      const treatment = buildMockDirectorTreatment(treatmentInput);

      return deps.treatmentRepository.createTreatment({
        id: `treat_${candidate.id}`,
        candidateId: candidate.id,
        provider: "MOCK",
        model: mockDirectorModelLabel,
        providerRequestId: null,
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

  let liveProvider: OpenAIDirectorTreatmentProvider | undefined;
  if (env.DIRECTOR_PROVIDER === "OPENAI") {
    // Defense in depth: the startup environment schema already required
    // both settings for this selection, so this only throws on a singleton
    // constructed against an unvalidated environment.
    const resolved = resolveOpenAIDirectorAdapterConfig(env);
    if (!resolved.selected) {
      throw new OpenAIDirectorAdapterError(
        "PROVIDER_CREDENTIALS_REQUIRED",
        "DIRECTOR_PROVIDER=OPENAI requires non-empty OPENAI_API_KEY and OPENAI_DIRECTOR_MODEL settings.",
      );
    }
    liveProvider = createOpenAIDirectorTreatmentProvider(resolved.config);
  }

  service = createDirectorTreatmentService({
    candidateRepository: getCandidateRepository(),
    treatmentRepository: createDirectorTreatmentRepository(connection.database),
    selection: env.DIRECTOR_PROVIDER,
    liveProvider,
  });
  return service;
}
