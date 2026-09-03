import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  computeTrendCandidateFingerprint,
  parseAndNormalizeTrendFeed,
  planTrendRun,
} from "@/domain/trend-scout";
import { env } from "@/lib/env";
import {
  CandidateIntakeError,
  createTrendFeedCandidateIntakeProvider,
  importCandidates,
} from "@/server/candidates/intake";
import type { CandidateRepository } from "@/server/candidates/repository";
import { getCandidateRepository } from "@/server/candidates/service";
import { createDatabaseProvider } from "@/server/db/client";

import { createFeedRunRepository } from "./feed-run-repository";
import type { FeedRunRepository } from "./feed-run-repository";
import { createDefaultTrendFeedProviders } from "./feed-providers";
import type { TrendFeedProvider } from "./feed-providers";
import type {
  FeedRunErrorCode,
  FeedRunResource,
  RunScoutRequest,
  TrendFeed,
} from "@/shared/trend-scout";
import type { NormalizedTrendItem } from "@/domain/trend-scout";

const maxSafeMessageLength = 400;

export interface ScoutRunServiceDeps {
  feedRunRepository: FeedRunRepository;
  candidateRepository: CandidateRepository;
  providers: readonly TrendFeedProvider[];
  /** Injectable clock so runs are deterministic in tests. */
  now?: () => Date;
}

interface RunFailure {
  code: FeedRunErrorCode;
  message: string;
}

function truncateSafeMessage(message: string): string {
  return message.length > maxSafeMessageLength
    ? `${message.slice(0, maxSafeMessageLength - 3)}...`
    : message;
}

function summarizeZodIssues(error: z.ZodError, label: string): string {
  const issues = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .slice(0, 5)
    .join("; ");
  return `${label} did not match the Trend Feed contract: ${issues}`;
}

/**
 * Fingerprint dedupe compares against candidates that already exist in the
 * repository, so a moment imported by an earlier run (or by any other
 * intake path with the same content) is recognized as a duplicate.
 */
function collectKnownFingerprints(
  candidateRepository: CandidateRepository,
): Set<string> {
  return new Set(
    candidateRepository.list().map((candidate) =>
      computeTrendCandidateFingerprint({
        platform: candidate.platform,
        caption: candidate.caption,
      }),
    ),
  );
}

export function createScoutRunService(deps: ScoutRunServiceDeps) {
  const now = deps.now ?? (() => new Date());

  function selectProviders(themes: readonly string[] | undefined) {
    return themes
      ? deps.providers.filter((provider) => themes.includes(provider.theme))
      : deps.providers;
  }

  function run(request: RunScoutRequest): FeedRunResource {
    const startedAt = now().toISOString();
    const providers = selectProviders(request.themes);
    const themes = providers.map((provider) => provider.theme);

    const finishFailed = (failure: RunFailure): FeedRunResource => ({
      id: `run_${randomUUID()}`,
      themes,
      status: "FAILED",
      discoveredCount: 0,
      duplicateCount: 0,
      importedCount: 0,
      importedCandidateIds: [],
      errorCode: failure.code,
      safeErrorMessage: truncateSafeMessage(failure.message),
      startedAt,
      completedAt: now().toISOString(),
    });

    // Validate every selected feed against the Trend Feed contract before
    // touching the repository; one malformed provider fails the whole run
    // rather than importing a partial slice under a success status.
    const normalizedByFeed: {
      feed: TrendFeed;
      normalized: NormalizedTrendItem[];
    }[] = [];
    for (const provider of providers) {
      try {
        normalizedByFeed.push(parseAndNormalizeTrendFeed(provider.load()));
      } catch (error) {
        const failure: RunFailure =
          error instanceof z.ZodError
            ? {
                code: "PROVIDER_INVALID_FEED",
                message: summarizeZodIssues(error, provider.theme),
              }
            : {
                code: "UNEXPECTED_ERROR",
                message: `Scout run failed while reading the ${provider.theme} feed.`,
              };
        return finishFailed(failure);
      }
    }

    try {
      const plan = planTrendRun({
        normalizedByFeed: normalizedByFeed.map(({ normalized }) => normalized),
        knownFingerprints: collectKnownFingerprints(deps.candidateRepository),
      });
      const importNow = now().toISOString();
      const intake = importCandidates({
        provider: createTrendFeedCandidateIntakeProvider(
          plan.fresh.map(({ intakeRecord }) => intakeRecord),
        ),
        repository: deps.candidateRepository,
        now: importNow,
      });

      const run: FeedRunResource = {
        id: `run_${randomUUID()}`,
        themes,
        status: "COMPLETE",
        discoveredCount: plan.discovered,
        duplicateCount: plan.duplicates,
        importedCount: intake.imported,
        importedCandidateIds: [...intake.candidateIds],
        startedAt,
        completedAt: importNow,
      };
      deps.feedRunRepository.create({
        run,
        sourceKind: deps.providers[0]!.kind,
      });
      return run;
    } catch (error) {
      if (error instanceof CandidateIntakeError) {
        return finishFailed({
          code: "INTAKE_REJECTED",
          message: `Candidate intake rejected the discovered moments: ${error.issues.slice(0, 5).join("; ")}`,
        });
      }
      return finishFailed({
        code: "UNEXPECTED_ERROR",
        message: "Scout run failed unexpectedly.",
      });
    }
  }

  return {
    run,

    listRuns(): FeedRunResource[] {
      return deps.feedRunRepository.list();
    },

    latestRun(): FeedRunResource | undefined {
      return deps.feedRunRepository.latest();
    },
  };
}

export type ScoutRunService = ReturnType<typeof createScoutRunService>;

// `demo:reset` replaces the database file between rehearsal runs; the
// provider reopens the connection so a running web server never serves
// pre-reset rows. Mirrors the candidate service singleton.
const databaseProvider = createDatabaseProvider(env.DATABASE_URL);

let service: ScoutRunService | undefined;
let cachedConnection:
  | ReturnType<typeof databaseProvider.getConnection>
  | undefined;

export function getScoutRunService(): ScoutRunService {
  const connection = databaseProvider.getConnection();
  if (service && cachedConnection === connection) return service;

  cachedConnection = connection;
  service = createScoutRunService({
    feedRunRepository: createFeedRunRepository(connection.database),
    candidateRepository: getCandidateRepository(),
    providers: createDefaultTrendFeedProviders(),
  });
  return service;
}
