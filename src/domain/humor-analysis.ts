/**
 * Deterministic Humor Analyst engine.
 *
 * Reads a candidate's comment corpus and produces explainable laughter
 * evidence: which laughter markers fired, how sentiment aggregates, how
 * much of the corpus actually laughed, and where the evidence is honest
 * about its own gaps. Every output is derived mechanically from the
 * corpus text — no model calls, no randomness — so the same corpus always
 * yields the same analysis.
 *
 * Boundary that matters: everything here is EVIDENCE for the analyst
 * panel. None of it feeds the locked 40/30/30 candidate scoring math in
 * src/domain/scoring.ts.
 */
import { z } from "zod";

/** Where a analyzed corpus came from; drives the honest-source label. */
export const humorAnalysisCorpusSources = [
  "DEMO_CORPUS",
  "PERSISTED_EXCERPTS",
] as const;

/** Laughter-marker families the analyst tracks separately. */
export const laughterMarkerCategories = [
  "direct",
  "patois",
  "emoji",
  "hyperbole",
] as const;

export type LaughterMarkerCategory = (typeof laughterMarkerCategories)[number];
export type CorpusSource = (typeof humorAnalysisCorpusSources)[number];

export const sentimentLabels = ["POSITIVE", "NEUTRAL", "NEGATIVE"] as const;
export type SentimentLabel = (typeof sentimentLabels)[number];

/** How many tokens before a hit count as its negation window. */
export const sentimentNegationWindow = 3;
/** Demo corpora carry exactly ten comments per candidate. */
export const demoCorpusSize = 10;
/** Corpora at or below this size get the small-corpus honesty gap. */
export const smallCorpusThreshold = 5;
/** How many top markers the summary keeps. */
export const topMarkerLimit = 5;

export interface LaughterMarkerDefinition {
  /** Stable id used in tests, persistence, and the top-markers table. */
  id: string;
  /** Human label rendered in explanations and the panel. */
  label: string;
  category: LaughterMarkerCategory;
  pattern: RegExp;
}

/**
 * The laughter lexicon. Order is precedence: longer, more specific
 * expressions are listed before their generic fragments so "mi dead"
 * consumes the span and "dead" never double-counts it. Detection is
 * span-based with overlap suppression, not naive substring counting.
 */
const laughterMarkerLexicon: readonly LaughterMarkerDefinition[] = [
  // --- Patois idioms (longest first: each consumes its own span) ---
  {
    id: "mi-dead",
    label: "Mi dead",
    category: "patois",
    pattern: /\bmi dead\b/iu,
  },
  {
    id: "mi-weak",
    label: "Mi weak",
    category: "patois",
    pattern: /\bmi weak\b/iu,
  },
  {
    id: "yuh-kill-me",
    label: "Yuh kill me",
    category: "patois",
    pattern: /\byuh (?:done )?kill m[ei]\b/iu,
  },
  {
    id: "kills-mi",
    label: "Kills mi",
    category: "patois",
    pattern: /\bkills? mi\b/iu,
  },
  {
    id: "mi-belly",
    label: "Mi belly",
    category: "patois",
    pattern: /\bmi belly\b/iu,
  },
  {
    id: "nuh-normal",
    label: "Nuh normal",
    category: "patois",
    pattern: /\bnuh normal\b/iu,
  },

  // --- Emoji markers (distinct ids; duplicates collapse) ---
  {
    id: "\u{1F602}",
    label: "\u{1F602}",
    category: "emoji",
    pattern: /\u{1F602}/gu,
  },
  {
    id: "\u{1F923}",
    label: "\u{1F923}",
    category: "emoji",
    pattern: /\u{1F923}/gu,
  },
  {
    id: "\u{1F480}",
    label: "\u{1F480}",
    category: "emoji",
    pattern: /\u{1F480}/gu,
  },

  // --- Direct laughter ---
  { id: "lmao", label: "LMAO", category: "direct", pattern: /\blmaoo*\b/iu },
  { id: "lol", label: "LOL", category: "direct", pattern: /\blo+l\b/iu },
  { id: "rofl", label: "ROFL", category: "direct", pattern: /\brofl\b/iu },
  {
    id: "hahaha",
    label: "Hahaha",
    category: "direct",
    pattern: /\bha(ha)+\b/iu,
  },
  { id: "hehe", label: "Hehe", category: "direct", pattern: /\bhe(he)+\b/iu },
  {
    id: "im-dead",
    label: "I'm dead",
    category: "direct",
    pattern: /\bi[’']m dead\b/iu,
  },
  { id: "dying", label: "Dying", category: "direct", pattern: /\bdying\b/iu },
  {
    id: "crying",
    label: "Crying",
    category: "direct",
    pattern: /\b(?:got|had) me (?:crying|weak)\b/iu,
  },

  // --- Generic fragments AFTER idioms so idioms win overlap resolution ---
  { id: "dead", label: "Dead", category: "direct", pattern: /\bdead\b/iu },
  { id: "weak", label: "Weak", category: "direct", pattern: /\bweak\b/iu },

  // --- Hyperbole expressions ---
  {
    id: "too-accurate",
    label: "Too accurate",
    category: "hyperbole",
    pattern: /\btoo accurate\b/iu,
  },
  {
    id: "called-me-out",
    label: "Called me out",
    category: "hyperbole",
    pattern: /\bcalled me out\b/iu,
  },
  {
    id: "why-is-this",
    label: "Why is this",
    category: "hyperbole",
    pattern: /\bwhy is this\b/iu,
  },
  {
    id: "not-the",
    label: "Not the…",
    category: "hyperbole",
    pattern: /\bnot the\b/iu,
  },
];

interface MarkerSpan {
  marker: LaughterMarkerDefinition;
  start: number;
  end: number;
}

export interface DetectedMarker {
  id: string;
  label: string;
  category: LaughterMarkerCategory;
}

/**
 * Find laughter markers in one comment: collect every lexicon match as a
 * span, resolve overlaps greedily (earliest start wins, longer spans win
 * ties — that is what gives idioms precedence over generic fragments),
 * then keep the first occurrence of each marker id.
 */
export function detectMarkers(text: string): DetectedMarker[] {
  const spans: MarkerSpan[] = [];
  for (const marker of laughterMarkerLexicon) {
    // matchAll requires the g flag; lexicon patterns are declared without
    // one, so scan with a per-marker global clone instead.
    const globalPattern = marker.pattern.flags.includes("g")
      ? marker.pattern
      : new RegExp(marker.pattern.source, `${marker.pattern.flags}g`);
    globalPattern.lastIndex = 0;
    for (const match of text.matchAll(globalPattern)) {
      const start = match.index;
      if (start === undefined) {
        continue;
      }
      spans.push({ marker, start, end: start + match[0].length });
    }
  }

  spans.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.end ||
      a.marker.id.localeCompare(b.marker.id),
  );

  const accepted: MarkerSpan[] = [];
  for (const span of spans) {
    if (
      accepted.some((kept) => span.start < kept.end && span.end > kept.start)
    ) {
      continue;
    }
    accepted.push(span);
  }

  const seen = new Set<string>();
  const markers: DetectedMarker[] = [];
  for (const span of accepted) {
    if (seen.has(span.marker.id)) {
      continue;
    }
    seen.add(span.marker.id);
    markers.push({
      id: span.marker.id,
      label: span.marker.label,
      category: span.marker.category,
    });
  }
  return markers;
}

const positiveSentimentUnigrams = [
  "great",
  "accurate",
  "clean",
  "proper",
  "relatable",
  "iconic",
  "perfect",
  "sweet",
  "facts",
  "fire",
  "love",
  "best",
] as const;

const negativeSentimentUnigrams = [
  "boring",
  "lazy",
  "bad",
  "awful",
  "cringe",
  "stale",
  "forced",
  "dry",
] as const;

const positiveSentimentPhrases = ["big up"] as const;
const negativeSentimentPhrases = ["nuh good"] as const;

/** Negative-space tokens that flip a nearby sentiment hit. */
const sentimentNegationTokens = new Set([
  "not",
  "no",
  "never",
  "cant",
  "can't",
  "cyaan",
  "nuh",
  "nah",
  "isnt",
  "isn't",
  "wasnt",
  "wasn't",
  "dont",
  "don't",
  "doesnt",
  "doesn't",
  "nothing",
  "hardly",
  "without",
  "aint",
  "ain't",
]);

const positiveSentimentEmoji = ["\u2764", "\u{1F525}", "\u{1F44F}"] as const;
const negativeSentimentEmoji = ["\u{1F44E}"] as const;

export interface SentimentResult {
  sentiment: SentimentLabel;
  /** Human-readable evidence: what the label was read from. */
  basis: string[];
}

/**
 * Aggregate sentiment for one comment. Two-pass token scan: sentiment
 * phrases (which consume their second token) first, then unigrams and
 * emoji. A unigram hit is negated — and flips polarity — when any of the
 * three tokens before it is a negation token.
 */
export function aggregateSentiment(text: string): SentimentResult {
  const tokens =
    text
      .toLowerCase()
      .replace(/[’]/g, "'")
      .match(/[a-z0-9']+|[\u2190-\u2BFF\u{1F000}-\u{1FAFF}\u2764]/gu) ?? [];

  const basis: string[] = [];
  let positive = 0;
  let negative = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const bigram = `${tokens[index]} ${tokens[index + 1] ?? ""}`;

    if (positiveSentimentPhrases.includes(bigram as never)) {
      positive += 1;
      basis.push(bigram);
      index += 1;
      continue;
    }
    if (negativeSentimentPhrases.includes(bigram as never)) {
      negative += 1;
      basis.push(bigram);
      index += 1;
      continue;
    }

    const token = tokens[index];
    if (
      positiveSentimentEmoji.some(
        (emoji) => token === emoji.toLowerCase() || token === emoji,
      )
    ) {
      positive += 1;
      basis.push("1 positive emoji");
      continue;
    }
    if (
      negativeSentimentEmoji.some(
        (emoji) => token === emoji.toLowerCase() || token === emoji,
      )
    ) {
      negative += 1;
      basis.push("1 negative emoji");
      continue;
    }

    const negated = tokens
      .slice(Math.max(0, index - sentimentNegationWindow), index)
      .some((previous) => sentimentNegationTokens.has(previous));

    if (positiveSentimentUnigrams.includes(token as never)) {
      if (negated) {
        negative += 1;
        basis.push(`${token} (negated)`);
      } else {
        positive += 1;
        basis.push(token);
      }
      continue;
    }
    if (negativeSentimentUnigrams.includes(token as never)) {
      if (negated) {
        positive += 1;
        basis.push(`${token} (negated)`);
      } else {
        negative += 1;
        basis.push(token);
      }
    }
  }

  const sentiment: SentimentLabel =
    positive > negative
      ? "POSITIVE"
      : negative > positive
        ? "NEGATIVE"
        : "NEUTRAL";
  return { sentiment, basis };
}

export interface CommentAnalysis {
  /** Position of the comment within the corpus, zero-indexed. */
  position: number;
  text: string;
  markers: DetectedMarker[];
  isLaughter: boolean;
  sentiment: SentimentLabel;
  sentimentBasis: string[];
  explanation: string;
}

export interface HumorAnalysisSummary {
  laughterCommentCount: number;
  /** Share of comments carrying at least one marker, 0–1. */
  laughterCoverage: number;
  averageMarkersPerComment: number;
  sentimentCounts: Record<SentimentLabel, number>;
  dominantSentiment: SentimentLabel;
  categoryCommentCounts: Record<LaughterMarkerCategory, number>;
  topMarkers: Array<{ markerId: string; label: string; count: number }>;
  /** 0–100 blend of laughter coverage and positive share among laughter. */
  laughterSignal: number;
  summaryExplanation: string;
}

export interface CommentCorpusAnalysis {
  corpusSize: number;
  comments: CommentAnalysis[];
  summary: HumorAnalysisSummary;
  evidenceGaps: string[];
  confidence: number;
}

const categoryDisplayNames: Record<LaughterMarkerCategory, string> = {
  direct: "Direct",
  patois: "Patois",
  emoji: "Emoji",
  hyperbole: "Hyperbole",
};

/** Confidence never reads as certainty; the floor keeps it honest. */
const confidenceCeiling = 0.95;
const confidenceFloor = 0.05;
const confidencePenalties = {
  noComments: 0.7,
  noLaughterMarkers: 0.2,
  smallCorpus: 0.15,
  noSentimentLanguage: 0.1,
} as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampConfidence(value: number): number {
  return Math.max(confidenceFloor, Math.min(confidenceCeiling, round2(value)));
}

function commentExplanation(
  markers: DetectedMarker[],
  sentiment: SentimentResult,
): string {
  const markerSentence =
    markers.length > 0
      ? `Detected laughter markers ${markers.map((marker) => `"${marker.label}"`).join(", ")}`
      : "Detected no laughter markers";
  const sentimentSentence =
    sentiment.basis.length > 0
      ? `${sentiment.sentiment.charAt(0)}${sentiment.sentiment.slice(1).toLowerCase()} sentiment (${sentiment.basis.join(", ")})`
      : "Neutral sentiment (no sentiment language matched)";
  return `${markerSentence}. ${sentimentSentence}.`;
}

function summarize(
  comments: CommentAnalysis[],
  corpusSize: number,
): HumorAnalysisSummary {
  const laughterCommentCount = comments.filter(
    (comment) => comment.isLaughter,
  ).length;
  const laughterCoverage =
    corpusSize === 0 ? 0 : laughterCommentCount / corpusSize;
  const averageMarkersPerComment =
    corpusSize === 0
      ? 0
      : round2(
          comments.reduce(
            (total, comment) => total + comment.markers.length,
            0,
          ) / corpusSize,
        );

  const sentimentCounts: Record<SentimentLabel, number> = {
    POSITIVE: 0,
    NEUTRAL: 0,
    NEGATIVE: 0,
  };
  for (const comment of comments) {
    sentimentCounts[comment.sentiment] += 1;
  }
  const dominantSentiment = (
    Object.keys(sentimentCounts) as SentimentLabel[]
  ).sort((a, b) => sentimentCounts[b] - sentimentCounts[a])[0];

  const categoryCommentCounts = Object.fromEntries(
    laughterMarkerCategories.map((category) => [
      category,
      comments.filter((comment) =>
        comment.markers.some((marker) => marker.category === category),
      ).length,
    ]),
  ) as Record<LaughterMarkerCategory, number>;

  const markerCounts = new Map<string, { label: string; count: number }>();
  for (const comment of comments) {
    for (const marker of comment.markers) {
      const entry = markerCounts.get(marker.id);
      if (entry) {
        entry.count += 1;
      } else {
        markerCounts.set(marker.id, { label: marker.label, count: 1 });
      }
    }
  }
  const topMarkers = [...markerCounts.entries()]
    .map(([markerId, { label, count }]) => ({ markerId, label, count }))
    .sort((a, b) => b.count - a.count || a.markerId.localeCompare(b.markerId))
    .slice(0, topMarkerLimit);

  const laughterComments = comments.filter((comment) => comment.isLaughter);
  const positiveShareAmongLaughter =
    laughterComments.length === 0
      ? 0
      : laughterComments.filter((comment) => comment.sentiment === "POSITIVE")
          .length / laughterComments.length;
  const laughterSignal =
    corpusSize === 0
      ? 0
      : Math.round(
          100 * (0.7 * laughterCoverage + 0.3 * positiveShareAmongLaughter),
        );

  const summaryExplanation = buildSummaryExplanation({
    corpusSize,
    laughterCommentCount,
    sentimentCounts,
    dominantSentiment,
    categoryCommentCounts,
    laughterSignal,
  });

  return {
    laughterCommentCount,
    laughterCoverage: round2(laughterCoverage),
    averageMarkersPerComment,
    sentimentCounts,
    dominantSentiment,
    categoryCommentCounts,
    topMarkers,
    laughterSignal,
    summaryExplanation,
  };
}

function buildSummaryExplanation(input: {
  corpusSize: number;
  laughterCommentCount: number;
  sentimentCounts: Record<SentimentLabel, number>;
  dominantSentiment: SentimentLabel;
  categoryCommentCounts: Record<LaughterMarkerCategory, number>;
  laughterSignal: number;
}): string {
  if (input.corpusSize === 0) {
    return "The corpus is empty, so no laughter or sentiment evidence can be read.";
  }
  const coveragePercent = Math.round(
    (input.laughterCommentCount / input.corpusSize) * 100,
  );
  const coverageSentence = `${input.laughterCommentCount} of ${input.corpusSize} comments carried laughter markers (${coveragePercent}% coverage).`;
  const {
    POSITIVE: positive,
    NEUTRAL: neutral,
    NEGATIVE: negative,
  } = input.sentimentCounts;
  const sentimentSentence = `Sentiment runs ${input.dominantSentiment.toLowerCase()} (${positive} positive, ${neutral} neutral, ${negative} negative).`;
  // The leading category is the one with the MOST comments carrying it;
  // ties keep the lexicon's category order so output stays deterministic.
  const leadingCategory =
    laughterMarkerCategories.reduce<LaughterMarkerCategory | null>(
      (best, category) => {
        const count = input.categoryCommentCounts[category];
        if (count === 0) {
          return best;
        }
        if (best === null || count > input.categoryCommentCounts[best]) {
          return category;
        }
        return best;
      },
      null,
    );
  const categorySentence = leadingCategory
    ? ` ${categoryDisplayNames[leadingCategory]} laughter led with ${
        input.categoryCommentCounts[leadingCategory]
      } ${input.categoryCommentCounts[leadingCategory] === 1 ? "comment" : "comments"}.`
    : "";
  const signalSentence = ` Laughter signal ${input.laughterSignal}/100 is an evidence metric for the analyst panel; it does not feed the locked candidate scoring.`;
  return `${coverageSentence} ${sentimentSentence}${categorySentence}${signalSentence}`;
}

/**
 * Analyze a whole corpus deterministically. Evidence gaps name what the
 * numbers cannot honestly claim: no corpus, a corpus too small to treat
 * percentages as measurement, no laughter markers at all, or no sentiment
 * language matched.
 */
export function analyzeCommentCorpus(
  comments: readonly string[],
): CommentCorpusAnalysis {
  const analyzed: CommentAnalysis[] = comments.map((text, position) => {
    const markers = detectMarkers(text);
    const sentiment = aggregateSentiment(text);
    return {
      position,
      text,
      markers,
      isLaughter: markers.length > 0,
      sentiment: sentiment.sentiment,
      sentimentBasis: sentiment.basis,
      explanation: commentExplanation(markers, sentiment),
    };
  });

  const evidenceGaps: string[] = [];
  if (comments.length === 0) {
    evidenceGaps.push(
      "No comment excerpts were supplied, so there is no corpus to analyze.",
    );
  } else if (comments.length <= smallCorpusThreshold) {
    evidenceGaps.push(
      `Fewer than ${smallCorpusThreshold} comments were supplied, so coverage shares are a hint rather than a measurement.`,
    );
  }
  if (
    comments.length > 0 &&
    analyzed.every((comment) => comment.markers.length === 0)
  ) {
    evidenceGaps.push(
      "No configured laughter markers appeared in the corpus, so the laughter signal is zero by evidence.",
    );
  }
  if (analyzed.every((comment) => comment.sentimentBasis.length === 0)) {
    evidenceGaps.push(
      "No sentiment language was matched, so the corpus aggregated to neutral.",
    );
  }

  let confidence = confidenceCeiling;
  if (comments.length === 0) {
    confidence -= confidencePenalties.noComments;
  }
  if (comments.length > 0 && analyzed.every((comment) => !comment.isLaughter)) {
    confidence -= confidencePenalties.noLaughterMarkers;
  }
  if (comments.length > 0 && comments.length <= smallCorpusThreshold) {
    confidence -= confidencePenalties.smallCorpus;
  }
  if (analyzed.every((comment) => comment.sentimentBasis.length === 0)) {
    confidence -= confidencePenalties.noSentimentLanguage;
  }

  return {
    corpusSize: comments.length,
    comments: analyzed,
    summary: summarize(analyzed, comments.length),
    evidenceGaps,
    confidence: clampConfidence(confidence),
  };
}

const detectedMarkerSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(laughterMarkerCategories),
});

const commentAnalysisSchema = z.object({
  position: z.number().int().nonnegative(),
  text: z.string(),
  markers: z.array(detectedMarkerSchema),
  isLaughter: z.boolean(),
  sentiment: z.enum(sentimentLabels),
  sentimentBasis: z.array(z.string()),
  explanation: z.string(),
});

const humorAnalysisSummarySchema = z.object({
  laughterCommentCount: z.number().int().nonnegative(),
  laughterCoverage: z.number(),
  averageMarkersPerComment: z.number(),
  sentimentCounts: z.object({
    POSITIVE: z.number().int().nonnegative(),
    NEUTRAL: z.number().int().nonnegative(),
    NEGATIVE: z.number().int().nonnegative(),
  }),
  dominantSentiment: z.enum(sentimentLabels),
  categoryCommentCounts: z.object({
    direct: z.number().int().nonnegative(),
    patois: z.number().int().nonnegative(),
    emoji: z.number().int().nonnegative(),
    hyperbole: z.number().int().nonnegative(),
  }),
  topMarkers: z.array(
    z.object({
      markerId: z.string(),
      label: z.string(),
      count: z.number().int().positive(),
    }),
  ),
  laughterSignal: z.number().int().min(0).max(100),
  summaryExplanation: z.string(),
});

export const commentCorpusAnalysisSchema = z.object({
  corpusSize: z.number().int().nonnegative(),
  comments: z.array(commentAnalysisSchema),
  summary: humorAnalysisSummarySchema,
  evidenceGaps: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const humorAnalysisResourceSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  corpusSource: z.enum(humorAnalysisCorpusSources),
  createdAt: z.string(),
  analysis: commentCorpusAnalysisSchema,
});

export const humorAnalysisResponseSchema = z.object({
  analysis: humorAnalysisResourceSchema,
});

export const createHumorAnalysisRequestSchema = z
  .object({ candidateId: z.string().min(1) })
  .strict();

export const humorAnalysisQuerySchema = z.object({
  candidateId: z.string().min(1),
});

export type HumorAnalysisResource = z.infer<typeof humorAnalysisResourceSchema>;
export type HumorAnalysisResponse = z.infer<typeof humorAnalysisResponseSchema>;
export type CreateHumorAnalysisRequest = z.infer<
  typeof createHumorAnalysisRequestSchema
>;
