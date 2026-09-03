import { z } from "zod";

import { directorProviders } from "@/lib/providers";
import type { EngagementMetrics } from "@/shared/candidates";
import { engagementMetricsSchema } from "@/shared/candidates";

import { minSegmentSeconds } from "./production-setup";

/**
 * The Director Agent turns received candidate evidence into a creative
 * treatment. Two rules are structural, not stylistic:
 *
 * 1. The Director quotes only evidence it received. Every audience-reaction
 *    quote must be traceable to a comment excerpt, the caption, or supplied
 *    engagement metrics — missing evidence becomes an explicit gap.
 * 2. Missing evidence degrades confidence; it never invents quotes or
 *    engagement numbers.
 */

export const directorEvidenceSources = [
  "comment",
  "metric",
  "caption",
] as const;
export type DirectorEvidenceSource = (typeof directorEvidenceSources)[number];

export const audienceReactionEvidenceSchema = z
  .object({
    source: z.enum(directorEvidenceSources),
    quote: z.string().trim().min(1),
    weight: z.number().min(0).max(1),
  })
  .readonly();
export type AudienceReactionEvidence = z.infer<
  typeof audienceReactionEvidenceSchema
>;

export const recommendedSegmentSchema = z
  .object({
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().positive(),
  })
  .superRefine((segment, context) => {
    if (segment.endSeconds <= segment.startSeconds) {
      context.addIssue({
        code: "custom",
        message: "The recommended segment must end after it starts.",
        path: ["endSeconds"],
      });
    }
  })
  .readonly();
export type RecommendedSegment = z.infer<typeof recommendedSegmentSchema>;

export const directorTreatmentSchema = z
  .object({
    // Why the candidate is funny, mechanically.
    humorMechanism: z.string().trim().min(1).max(2000),
    // Real excerpts and received numbers only — never synthesized.
    audienceReactionEvidence: z
      .array(audienceReactionEvidenceSchema)
      .readonly(),
    recommendedSegment: recommendedSegmentSchema,
    // Both markers must sit inside the recommended segment; the payoff
    // completes the setup instead of preceding it.
    setupTimestamp: z.number().finite().min(0),
    payoffTimestamp: z.number().finite().min(0),
    adaptationConcept: z.string().trim().min(1).max(2000),
    // Prompt routed to the OpenAI image stage when imageProvider = OPENAI.
    claymationPrompt: z.string().trim().min(1).max(2000),
    // Prompt routed to Runway promptText when animationProvider = RUNWAY.
    motionPrompt: z.string().trim().min(1).max(2000),
    // Caption package for the video-plus-caption download bundle.
    socialCaption: z.string().trim().min(1).max(2200),
    confidence: z.number().min(0).max(1),
    risks: z.array(z.string().trim().min(1)).readonly(),
    // What was missing from the evidence — never fabricated.
    evidenceGaps: z.array(z.string().trim().min(1)).readonly(),
  })
  .superRefine((treatment, context) => {
    const segment = treatment.recommendedSegment;
    for (const [field, value] of [
      ["setupTimestamp", treatment.setupTimestamp],
      ["payoffTimestamp", treatment.payoffTimestamp],
    ] as const) {
      if (value < segment.startSeconds || value > segment.endSeconds) {
        context.addIssue({
          code: "custom",
          message: `${field} must sit inside the recommended segment.`,
          path: [field],
        });
      }
    }
    if (treatment.payoffTimestamp < treatment.setupTimestamp) {
      context.addIssue({
        code: "custom",
        message: "The payoff must not come before the setup.",
        path: ["payoffTimestamp"],
      });
    }
  })
  .readonly();
export type DirectorTreatment = z.infer<typeof directorTreatmentSchema>;

export const directorSourceVideoMetadataSchema = z
  .object({
    durationSeconds: z.number().finite().positive(),
    audioPresent: z.boolean(),
  })
  .strict()
  .readonly();
export type DirectorSourceVideoMetadata = z.infer<
  typeof directorSourceVideoMetadataSchema
>;

export const directorKeyframeSchema = z
  .object({ sourceTimestampSeconds: z.number().finite().min(0) })
  .strict()
  .readonly();
export type DirectorKeyframe = z.infer<typeof directorKeyframeSchema>;

/** Everything the Director may read. Every optional field is honest absence. */
export const directorTreatmentInputSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    metrics: engagementMetricsSchema,
    commentExcerpts: z.array(z.string().trim().min(1)).readonly(),
    adaptationNote: z.string().trim().min(1).optional(),
    transcript: z.string().trim().min(1).optional(),
    sourceVideoMetadata: directorSourceVideoMetadataSchema.optional(),
    keyframes: z.array(directorKeyframeSchema).readonly().optional(),
    creativeDirection: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .readonly();
export type DirectorTreatmentInput = z.infer<
  typeof directorTreatmentInputSchema
>;

export const createDirectorTreatmentRequestSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    transcript: z.string().trim().min(1).optional(),
    sourceVideoMetadata: directorSourceVideoMetadataSchema.optional(),
    keyframes: z.array(directorKeyframeSchema).optional(),
    creativeDirection: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .readonly();
export type CreateDirectorTreatmentRequest = z.infer<
  typeof createDirectorTreatmentRequestSchema
>;

export const directorTreatmentQuerySchema = z
  .object({ candidateId: z.string().trim().min(1) })
  .strict()
  .readonly();
export type DirectorTreatmentQuery = z.infer<
  typeof directorTreatmentQuerySchema
>;

export const directorTreatmentResourceSchema = z
  .object({
    id: z.string().trim().min(1),
    candidateId: z.string().trim().min(1),
    provider: z.enum(directorProviders),
    createdAt: z.iso.datetime(),
    treatment: directorTreatmentSchema,
  })
  .readonly();
export type DirectorTreatmentResource = z.infer<
  typeof directorTreatmentResourceSchema
>;

export const directorTreatmentResponseSchema = z
  .object({ treatment: directorTreatmentResourceSchema })
  .readonly();

export const directorApiErrorCodes = [
  "INVALID_REQUEST",
  "CANDIDATE_NOT_FOUND",
  "TREATMENT_NOT_FOUND",
  "INTERNAL_ERROR",
] as const;
export type DirectorApiErrorCode = (typeof directorApiErrorCodes)[number];

export const directorErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(directorApiErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .readonly();

/**
 * Evidence categories the Director checks for, the stable messages that
 * report their absence, and how much each absence degrades confidence.
 * Ordered so tests and UI render gaps in a fixed, predictable sequence.
 */
export const directorEvidenceGapMessages = {
  commentExcerpts:
    "No comment excerpts were received, so no audience quotes can be cited.",
  metrics:
    "No engagement metrics were received, so the reaction scale is unverified.",
  transcript:
    "No transcript was received, so jokes that play in audio are not represented.",
  sourceVideoMetadata:
    "No source video metadata was received, so the recommended segment defaults to the first six seconds.",
  keyframes:
    "No sampled keyframes were received, so the clay prompt has no visual anchor.",
} as const;
export type DirectorEvidenceGapKey = keyof typeof directorEvidenceGapMessages;

export const evidenceConfidencePenalties: Record<
  DirectorEvidenceGapKey,
  number
> = {
  commentExcerpts: 0.25,
  metrics: 0.2,
  transcript: 0.15,
  sourceVideoMetadata: 0.05,
  keyframes: 0.05,
};

/** The mock ceiling stays below 1.0: received evidence is never certainty. */
export const mockDirectorConfidenceCeiling = 0.95;

export const evidenceWeights = {
  commentWithLaughter: 0.9,
  comment: 0.6,
  caption: 0.4,
  metric: 0.3,
} as const;

export const defaultRecommendedSegmentSeconds = 6;

export interface DirectorEvidencePresence {
  hasComments: boolean;
  hasMetrics: boolean;
  hasTranscript: boolean;
  hasSourceVideoMetadata: boolean;
  hasKeyframes: boolean;
}

/**
 * Missing evidence is reported in the fixed gap order. An explicit zero
 * metric is data, not absence — it counts as present, mirroring the
 * candidate scoring rule that missing is not zero.
 */
export function evaluateEvidenceGaps(
  presence: DirectorEvidencePresence,
): DirectorEvidenceGapKey[] {
  return (
    [
      ["commentExcerpts", presence.hasComments],
      ["metrics", presence.hasMetrics],
      ["transcript", presence.hasTranscript],
      ["sourceVideoMetadata", presence.hasSourceVideoMetadata],
      ["keyframes", presence.hasKeyframes],
    ] as const
  )
    .filter(([, present]) => !present)
    .map(([key]) => key);
}

export function confidenceForGaps(
  gapKeys: readonly DirectorEvidenceGapKey[],
): number {
  const penalty = gapKeys.reduce(
    (sum, key) => sum + evidenceConfidencePenalties[key],
    0,
  );
  // Clamped so every confidence the helper emits satisfies the treatment
  // contract's 0..1 bound, even for inputs outside evaluateEvidenceGaps.
  const confidence = mockDirectorConfidenceCeiling - penalty;
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
}

function hasSuppliedMetrics(metrics: EngagementMetrics): boolean {
  return Object.values(metrics).some((value) => value !== undefined);
}

// Evidence-weighting heuristic: direct audience laughter outranks plain
// comments, the caption, and quantitative proxies. Separate from the
// scoring module's private patterns so each domain tunes its own bar.
const laughterMarkers = [
  /\blol+\b/iu,
  /\blmao+\b/iu,
  /\brofl\b/iu,
  /\bdead\b/iu,
  /\bweak\b/iu,
  /\bcrying\b/iu,
  /\bmi cyaan\b/iu,
  /😂/u,
  /🤣/u,
] as const;

function containsLaughterMarker(quote: string): boolean {
  return laughterMarkers.some((marker) => marker.test(quote));
}

/** Restates only the numbers that were actually received. */
function summarizeMetrics(metrics: EngagementMetrics): string {
  const supplied = Object.entries(metrics).filter(
    (entry): entry is [keyof EngagementMetrics, number] =>
      entry[1] !== undefined,
  );
  return `Received engagement metrics: ${supplied
    .map(([name, value]) => `${name} ${value}`)
    .join(", ")}`;
}

/**
 * Stable non-cryptic hash so the same candidate id always picks the same
 * variant — the mock is keyed to the candidate, never to wall-clock time.
 */
function stableVariantIndex(seed: string, variantCount: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1000003;
  }
  return hash % variantCount;
}

function describeHumorMechanism(input: DirectorTreatmentInput): string {
  const note = input.adaptationNote
    ? ` The editorial note sharpens the beat: "${input.adaptationNote}".`
    : "";
  const variants = [
    `Expectation subversion: the caption "${input.caption}" sets up a routine the audience knows, and the payoff breaks it at the last beat.${note}`,
    `Recognition comedy: the caption "${input.caption}" names a moment the audience has lived through, and the laughter comes from being caught in it.${note}`,
    `Escalation comedy: the caption "${input.caption}" opens small and every replayed beat tops the one before until the payoff lands.${note}`,
  ];
  return variants[stableVariantIndex(input.candidateId, variants.length)]!;
}

function describeAdaptationConcept(input: DirectorTreatmentInput): string {
  const subject = input.adaptationNote ?? input.caption;
  return `Single continuous clay scene in the Yard Toonz style: ${subject}`;
}

function describeClaymationPrompt(input: DirectorTreatmentInput): string {
  return `Claymation keyframe, hand-molded plasticine characters with visible thumbprints, warm Jamaican yard setting, 9:16 portrait framing. Scene: ${input.caption}`;
}

function describeMotionPrompt(
  setupTimestamp: number,
  payoffTimestamp: number,
): string {
  return `Slow push-in on the clay scene with subtle stop-motion jitter; hold the reaction from ${setupTimestamp}s to ${payoffTimestamp}s, then land the payoff. No camera cuts.`;
}

function describeSocialCaption(input: DirectorTreatmentInput): string {
  return `${input.caption} Rebuilt in clay by Yard Toonz.`;
}

interface SegmentRecommendation {
  segment: RecommendedSegment;
  sourceTooShort: boolean;
}

function recommendSegment(
  input: DirectorTreatmentInput,
): SegmentRecommendation {
  const duration = input.sourceVideoMetadata?.durationSeconds;
  if (duration === undefined) {
    return {
      segment: {
        startSeconds: 0,
        endSeconds: defaultRecommendedSegmentSeconds,
      },
      sourceTooShort: false,
    };
  }
  if (duration < minSegmentSeconds) {
    return {
      segment: { startSeconds: 0, endSeconds: duration },
      sourceTooShort: true,
    };
  }
  return {
    segment: {
      startSeconds: 0,
      endSeconds: Math.min(defaultRecommendedSegmentSeconds, duration),
    },
    sourceTooShort: false,
  };
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildRisks(
  input: DirectorTreatmentInput,
  recommendation: SegmentRecommendation,
): string[] {
  const risks: string[] = [];
  if (recommendation.sourceTooShort) {
    risks.push(
      `The source clip is ${input.sourceVideoMetadata?.durationSeconds}s long, shorter than the ${minSegmentSeconds}-second minimum segment the studio accepts.`,
    );
  }
  if ((input.keyframes ?? []).length === 0) {
    risks.push(
      "Without a sampled keyframe the first clay pass may drift from the source scene.",
    );
  }
  if (input.transcript === undefined) {
    risks.push("Without a transcript, jokes that play in audio may be missed.");
  }
  return risks;
}

/**
 * Deterministic MOCK treatment builder keyed to the candidate id: the same
 * id and evidence always produce the same treatment. Quotes come only from
 * received comments, the caption, and received metrics; everything missing
 * is reported as an evidence gap and lowers confidence.
 */
export function buildMockDirectorTreatment(
  input: DirectorTreatmentInput,
): DirectorTreatment {
  const validated = directorTreatmentInputSchema.parse(input);
  const gapKeys = evaluateEvidenceGaps({
    hasComments: validated.commentExcerpts.length > 0,
    hasMetrics: hasSuppliedMetrics(validated.metrics),
    hasTranscript: validated.transcript !== undefined,
    hasSourceVideoMetadata: validated.sourceVideoMetadata !== undefined,
    hasKeyframes: (validated.keyframes ?? []).length > 0,
  });

  const recommendation = recommendSegment(validated);
  const { startSeconds, endSeconds } = recommendation.segment;
  const span = endSeconds - startSeconds;
  const setupTimestamp = roundToDecimals(startSeconds + 0.25 * span, 1);
  const payoffTimestamp = roundToDecimals(startSeconds + 0.7 * span, 1);

  const audienceReactionEvidence: AudienceReactionEvidence[] = [
    ...validated.commentExcerpts.map((quote) => ({
      source: "comment" as const,
      quote,
      weight: containsLaughterMarker(quote)
        ? evidenceWeights.commentWithLaughter
        : evidenceWeights.comment,
    })),
    {
      source: "caption",
      quote: validated.caption,
      weight: evidenceWeights.caption,
    },
  ];
  if (hasSuppliedMetrics(validated.metrics)) {
    audienceReactionEvidence.push({
      source: "metric",
      quote: summarizeMetrics(validated.metrics),
      weight: evidenceWeights.metric,
    });
  }

  return directorTreatmentSchema.parse({
    humorMechanism: describeHumorMechanism(validated),
    audienceReactionEvidence,
    recommendedSegment: { startSeconds, endSeconds },
    setupTimestamp,
    payoffTimestamp,
    adaptationConcept: describeAdaptationConcept(validated),
    claymationPrompt: describeClaymationPrompt(validated),
    motionPrompt: describeMotionPrompt(setupTimestamp, payoffTimestamp),
    socialCaption: describeSocialCaption(validated),
    confidence: confidenceForGaps(gapKeys),
    risks: buildRisks(validated, recommendation),
    evidenceGaps: gapKeys.map((key) => directorEvidenceGapMessages[key]),
  });
}
