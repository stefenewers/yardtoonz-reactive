import "server-only";

import {
  analyzeCommentCorpus,
  type HumorAnalysisResource,
} from "@/domain/humor-analysis";
import {
  commentCorpusForCandidate,
  hasCommentCorpus,
} from "@/../fixtures/comment-corpora";
import { env } from "@/lib/env";

import type { CandidateRepository } from "@/server/candidates/repository";
import { getCandidateRepository } from "@/server/candidates/service";
import { createDatabaseProvider } from "@/server/db/client";

import { createHumorAnalysisRepository } from "./repository";
import type { HumorAnalysisRepository } from "./repository";

export interface HumorAnalysisServiceDeps {
  candidateRepository: CandidateRepository;
  analysisRepository: HumorAnalysisRepository;
}

export type AnalyzeCandidateOutcome =
  | { outcome: "CREATED"; analysis: HumorAnalysisResource }
  | { outcome: "CANDIDATE_NOT_FOUND" };

export function createHumorAnalysisService(deps: HumorAnalysisServiceDeps) {
  return {
    /**
     * Read the candidate's comment corpus and persist the analysis.
     * The corpus source is honest about what was analyzed: the demo
     * corpus only exists for candidates that carry persisted excerpts,
     * so candidates without excerpts analyze what they actually have.
     */
    analyze(candidateId: string): AnalyzeCandidateOutcome {
      const candidate = deps.candidateRepository.get(candidateId);
      if (!candidate) return { outcome: "CANDIDATE_NOT_FOUND" };

      const demoCorpus = hasCommentCorpus(candidate.id);
      const corpusSource = demoCorpus ? "DEMO_CORPUS" : "PERSISTED_EXCERPTS";
      const comments = demoCorpus
        ? commentCorpusForCandidate(candidate.id)
        : candidate.commentExcerpts;
      const analysis = analyzeCommentCorpus(comments);

      const resource = deps.analysisRepository.upsertAnalysis({
        id: `ha_${candidate.id}`,
        candidateId: candidate.id,
        corpusSource,
        analysis,
        now: new Date(),
      });
      return { outcome: "CREATED", analysis: resource };
    },

    get(id: string): HumorAnalysisResource | undefined {
      return deps.analysisRepository.getAnalysis(id);
    },

    getForCandidate(candidateId: string): HumorAnalysisResource | undefined {
      return deps.analysisRepository.getAnalysisForCandidate(candidateId);
    },
  };
}

export type HumorAnalysisService = ReturnType<
  typeof createHumorAnalysisService
>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the storyboard service singleton.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: HumorAnalysisService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getHumorAnalysisService(): HumorAnalysisService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createHumorAnalysisService({
    candidateRepository: getCandidateRepository(),
    analysisRepository: createHumorAnalysisRepository(connection.database),
  });
  return service;
}
