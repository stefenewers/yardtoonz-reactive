import type { CandidateIntakeRecord } from "@/shared/candidate-intake";
import {
  feedRunResourceSchema,
  trendFeedSchema,
  type FeedRunResource,
  type FeedRunStatus,
  type TrendFeed,
} from "@/shared/trend-scout";

/**
 * Pure Trend Scout logic: content fingerprints, feed normalization into
 * candidate intake records, run planning, and the presentation helpers the
 * inbox header renders. No I/O — every function is deterministic and
 * unit-testable without React, a database, or a clock.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 32-bit FNV-1a with a salt, as hex. The domain keeps hashing dependency
 * free; the scout fingerprint combines two salts for a 64-bit space.
 */
function fnv1a(input: string, salt: number): string {
  let hash = FNV_OFFSET_BASIS ^ salt;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Feed identity is content identity: platform plus caption, compared
 * case- and whitespace-insensitively, because reposts drift in casing and
 * spacing while presenting the same moment.
 */
export function normalizeTrendCaption(caption: string): string {
  return caption.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeTrendItemFingerprint(item: {
  platform: string;
  caption: string;
}): string {
  const caption = normalizeTrendCaption(item.caption);
  return `${fnv1a(`${item.platform}\n${caption}`, 0x1)}${fnv1a(caption, 0x9e3779b9)}`;
}

export function computeTrendCandidateFingerprint(candidate: {
  platform: string;
  caption: string;
}): string {
  return computeTrendItemFingerprint(candidate);
}

export interface NormalizedTrendItem {
  fingerprint: string;
  /**
   * The candidate id is derived from the fingerprint so the same moment
   * discovered twice — across feeds, runs, or intake paths — always maps
   * to one candidate row instead of colliding at import time.
   */
  intakeRecord: CandidateIntakeRecord;
}

/**
 * Validate a provider's feed payload against the Trend Feed contract and
 * normalize every item into an intake record. This is the seam that keeps
 * the intake factories provider-agnostic: what comes out already matches
 * `candidateIntakeRecordSchema`.
 */
export function parseAndNormalizeTrendFeed(payload: unknown): {
  feed: TrendFeed;
  normalized: NormalizedTrendItem[];
} {
  const feed = trendFeedSchema.parse(payload);
  const normalized = feed.items.map((item) => {
    const fingerprint = computeTrendItemFingerprint(item);
    return {
      fingerprint,
      intakeRecord: {
        id: `cand_scout_${fingerprint}`,
        platform: item.platform,
        sourceLabel: item.sourceLabel,
        caption: item.caption,
        publishedAt: item.publishedAt,
        observedAt: item.observedAt,
        metrics: item.metrics,
        commentExcerpts: item.commentExcerpts,
        adaptationNote: item.adaptationNote,
        fitChecklist: item.fitChecklist,
      },
    } satisfies NormalizedTrendItem;
  });
  return { feed, normalized };
}

export interface TrendRunPlan {
  /** New moments in deterministic first-seen order, ready to import. */
  fresh: NormalizedTrendItem[];
  /**
   * In-batch repeats plus moments already in the candidate repository —
   * everything the run saw but will not import again.
   */
  duplicates: number;
  discovered: number;
}

/**
 * Plan one scout run across feeds in the given order. A fingerprint is
 * fresh only on its first appearance that is not already known; every
 * later sighting counts as a duplicate.
 */
export function planTrendRun(input: {
  normalizedByFeed: NormalizedTrendItem[][];
  knownFingerprints: ReadonlySet<string>;
}): TrendRunPlan {
  const seen = new Set<string>(input.knownFingerprints);
  const fresh: NormalizedTrendItem[] = [];
  let discovered = 0;
  let duplicates = 0;
  for (const normalized of input.normalizedByFeed) {
    for (const item of normalized) {
      discovered += 1;
      if (seen.has(item.fingerprint)) {
        duplicates += 1;
        continue;
      }
      seen.add(item.fingerprint);
      fresh.push(item);
    }
  }
  return { fresh, duplicates, discovered };
}

export function describeFeedRunCounts(run: FeedRunResource): string {
  const duplicates = `${run.duplicateCount} duplicate${run.duplicateCount === 1 ? "" : "s"}`;
  return `${run.discoveredCount} discovered · ${run.importedCount} imported · ${duplicates}`;
}

export function feedRunStatusLabel(status: FeedRunStatus): string {
  return status === "COMPLETE" ? "Complete" : "Failed";
}

/**
 * Relative age of the run for the header line. `nowMs` is injected so the
 * label is deterministic in tests.
 */
export function formatScoutRunRecency(
  run: FeedRunResource,
  nowMs: number | undefined,
): string {
  if (nowMs === undefined) return "";
  const completedMs = new Date(run.completedAt).getTime();
  const ageMs = nowMs - completedMs;
  if (!Number.isFinite(completedMs) || ageMs < 0) return "";
  if (ageMs < 60_000) return "just now";
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.floor(ageHours / 24)}d ago`;
}

/** Parse a persisted run payload back into the validated resource shape. */
export function parseFeedRunResource(payload: unknown): FeedRunResource {
  return feedRunResourceSchema.parse(payload);
}
