import { z } from "zod";

import type {
  CandidateScores,
  EngagementMetrics,
  FitChecklist,
  ScoreEvidence,
} from "@/shared/candidates";
import {
  engagementMetricsSchema,
  fitChecklistKeys,
  fitChecklistSchema,
} from "@/shared/candidates";

export const SCORING_VERSION = "candidate-v1";

export const scoringWeights = {
  viralMomentum: 0.4,
  humorResponse: 0.3,
  yardToonzFit: 0.3,
} as const;

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

const scoreInputSchema = z.number().int().min(0).max(100);

export const viralMomentumInputSchema = z
  .object({
    metrics: engagementMetricsSchema,
    publishedAt: z.iso.datetime().optional(),
    observedAt: z.iso.datetime(),
  })
  .refine(
    ({ publishedAt, observedAt }) =>
      publishedAt === undefined ||
      new Date(publishedAt).getTime() <= new Date(observedAt).getTime(),
    {
      message: "publishedAt must not be after observedAt",
      path: ["publishedAt"],
    },
  )
  .readonly();

export const humorResponseInputSchema = z
  .array(z.string().trim().min(1))
  .readonly();

export const overallScoreInputSchema = z
  .object({
    viralMomentum: scoreInputSchema,
    humorResponse: scoreInputSchema,
    yardToonzFit: scoreInputSchema,
  })
  .readonly();

export type ViralMomentumInput = z.infer<typeof viralMomentumInputSchema>;
export type HumorResponseInput = z.infer<typeof humorResponseInputSchema>;
export type OverallScoreInput = z.infer<typeof overallScoreInputSchema>;
export interface CandidateScoringInput extends ViralMomentumInput {
  commentExcerpts: HumorResponseInput;
  fitChecklist: FitChecklist;
}

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

export function scoreViralMomentum(input: ViralMomentumInput): ScoreEvidence {
  const validatedInput = viralMomentumInputSchema.parse(input);
  const suppliedMetrics = Object.entries(validatedInput.metrics).filter(
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

  const ageHours = validatedInput.publishedAt
    ? hoursBetween(validatedInput.publishedAt, validatedInput.observedAt)
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
  commentExcerpts: HumorResponseInput,
): ScoreEvidence {
  const validatedComments = humorResponseInputSchema.parse(commentExcerpts);
  if (validatedComments.length === 0) {
    return {
      score: 0,
      explanation:
        "No comment evidence was supplied, so humor response could not be measured.",
      inputsUsed: [],
    };
  }

  const matchedPatterns = laughPatterns.filter((pattern) =>
    validatedComments.some((comment) => pattern.test(comment)),
  );
  const commentsWithLaughter = validatedComments.filter((comment) =>
    laughPatterns.some((pattern) => pattern.test(comment)),
  ).length;
  const score = clampScore(
    (commentsWithLaughter / validatedComments.length) * 70 +
      Math.min(30, matchedPatterns.length * 6),
  );

  return {
    score,
    explanation: `${commentsWithLaughter} of ${validatedComments.length} supplied comment excerpts contained configured laugh language or emojis; general positive sentiment was not counted.`,
    inputsUsed: [`${validatedComments.length} comment excerpts`],
  };
}

export function scoreYardToonzFit(checklist: FitChecklist): ScoreEvidence {
  const validatedChecklist = fitChecklistSchema.parse(checklist);
  const passing = fitChecklistKeys.filter((key) => validatedChecklist[key]);
  const score = clampScore((passing.length / fitChecklistKeys.length) * 100);

  return {
    score,
    explanation: `${passing.length} of ${fitChecklistKeys.length} explicit editorial fit checks passed; engagement metrics were not used.`,
    inputsUsed: [...fitChecklistKeys],
  };
}

export function scoreOverall(input: OverallScoreInput): number {
  const scores = overallScoreInputSchema.parse(input);
  return clampScore(
    scores.viralMomentum * scoringWeights.viralMomentum +
      scores.humorResponse * scoringWeights.humorResponse +
      scores.yardToonzFit * scoringWeights.yardToonzFit,
  );
}

export function scoreCandidate(input: CandidateScoringInput): CandidateScores {
  const viralMomentum = scoreViralMomentum(input);
  const humorResponse = scoreHumorResponse(input.commentExcerpts);
  const yardToonzFit = scoreYardToonzFit(input.fitChecklist);

  return {
    viralMomentum,
    humorResponse,
    yardToonzFit,
    overall: scoreOverall({
      viralMomentum: viralMomentum.score,
      humorResponse: humorResponse.score,
      yardToonzFit: yardToonzFit.score,
    }),
    scoringVersion: SCORING_VERSION,
  };
}
