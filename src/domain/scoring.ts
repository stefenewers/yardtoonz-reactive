import type {
  CandidateScores,
  EngagementMetrics,
  FitChecklist,
  ScoreEvidence,
} from "@/shared/candidates";
import { fitChecklistKeys } from "@/shared/candidates";

export const SCORING_VERSION = "candidate-v1";

const metricCapsPerHour = {
  views: 50_000,
  likes: 5_000,
  comments: 1_000,
  shares: 1_000,
  saves: 1_000,
} as const satisfies Record<keyof EngagementMetrics, number>;

const laughPatterns = [
  /\blol+\b/iu,
  /\blmao+\b/iu,
  /\brofl\b/iu,
  /\bdead\b/iu,
  /\bweak\b/iu,
  /\bcrying\b/iu,
  /\bmi cyaan\b/iu,
  /😂|🤣/u,
] as const;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hoursBetween(publishedAt: string, observedAt: string): number {
  return Math.max(
    1,
    (new Date(observedAt).getTime() - new Date(publishedAt).getTime()) /
      3_600_000,
  );
}

function normalizeFeature(value: number, cap: number): number {
  return clampScore((Math.log1p(Math.min(value, cap)) / Math.log1p(cap)) * 100);
}

export function scoreViralMomentum(input: {
  metrics: EngagementMetrics;
  publishedAt?: string;
  observedAt: string;
}): ScoreEvidence {
  const suppliedMetrics = Object.entries(input.metrics).filter(
    (entry): entry is [keyof EngagementMetrics, number] =>
      entry[1] !== undefined,
  );

  if (suppliedMetrics.length === 0) {
    return {
      score: 0,
      explanation:
        "No engagement metrics were supplied, so viral momentum has no supporting evidence.",
      inputsUsed: [],
    };
  }

  const ageHours = input.publishedAt
    ? hoursBetween(input.publishedAt, input.observedAt)
    : undefined;
  const normalized = suppliedMetrics.map(([name, value]) => {
    const comparableValue = ageHours ? value / ageHours : value;
    return normalizeFeature(comparableValue, metricCapsPerHour[name]);
  });
  const score = clampScore(
    normalized.reduce((sum, value) => sum + value, 0) / normalized.length,
  );
  const missingCount =
    Object.keys(metricCapsPerHour).length - suppliedMetrics.length;
  const ageExplanation = ageHours
    ? `normalized across ${Math.round(ageHours)} source-age hours`
    : "source age was not supplied, so confidence is lower";
  const missingExplanation =
    missingCount > 0
      ? ` ${missingCount} optional metric${missingCount === 1 ? " was" : "s were"} not supplied.`
      : "";

  return {
    score,
    explanation: `${suppliedMetrics.length} supplied engagement metric${suppliedMetrics.length === 1 ? " was" : "s were"} capped and ${ageExplanation}.${missingExplanation}`,
    inputsUsed: suppliedMetrics.map(([name]) => name),
  };
}

export function scoreHumorResponse(
  commentExcerpts: readonly string[],
): ScoreEvidence {
  if (commentExcerpts.length === 0) {
    return {
      score: 0,
      explanation:
        "No comment evidence was supplied, so humor response could not be measured.",
      inputsUsed: [],
    };
  }

  const matchedPatterns = laughPatterns.filter((pattern) =>
    commentExcerpts.some((comment) => pattern.test(comment)),
  );
  const commentsWithLaughter = commentExcerpts.filter((comment) =>
    laughPatterns.some((pattern) => pattern.test(comment)),
  ).length;
  const score = clampScore(
    (commentsWithLaughter / commentExcerpts.length) * 70 +
      Math.min(30, matchedPatterns.length * 6),
  );

  return {
    score,
    explanation: `${commentsWithLaughter} of ${commentExcerpts.length} supplied comment excerpts contained configured laugh language or emojis; general positive sentiment was not counted.`,
    inputsUsed: [`${commentExcerpts.length} comment excerpts`],
  };
}

export function scoreYardToonzFit(checklist: FitChecklist): ScoreEvidence {
  const passing = fitChecklistKeys.filter((key) => checklist[key]);
  const score = clampScore((passing.length / fitChecklistKeys.length) * 100);

  return {
    score,
    explanation: `${passing.length} of ${fitChecklistKeys.length} explicit editorial fit checks passed; engagement metrics were not used.`,
    inputsUsed: [...fitChecklistKeys],
  };
}

export function scoreCandidate(input: {
  metrics: EngagementMetrics;
  publishedAt?: string;
  observedAt: string;
  commentExcerpts: readonly string[];
  fitChecklist: FitChecklist;
}): CandidateScores {
  const viralMomentum = scoreViralMomentum(input);
  const humorResponse = scoreHumorResponse(input.commentExcerpts);
  const yardToonzFit = scoreYardToonzFit(input.fitChecklist);

  return {
    viralMomentum,
    humorResponse,
    yardToonzFit,
    overall: clampScore(
      viralMomentum.score * 0.4 +
        humorResponse.score * 0.3 +
        yardToonzFit.score * 0.3,
    ),
    scoringVersion: SCORING_VERSION,
  };
}
