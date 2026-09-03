import { describe, expect, it } from "vitest";

import {
  computeTrendCandidateFingerprint,
  computeTrendItemFingerprint,
  describeFeedRunCounts,
  feedRunStatusLabel,
  formatScoutRunRecency,
  normalizeTrendCaption,
  parseAndNormalizeTrendFeed,
  planTrendRun,
} from "../../src/domain/trend-scout";
import { trendFeedFixtures } from "../../fixtures/trend-feeds";
import {
  candidateIntakeProviderKindSchema,
  candidateIntakeRecordSchema,
} from "../../src/shared/candidate-intake";
import {
  feedRunResourceSchema,
  type FeedRunResource,
  latestScoutRunResponseSchema,
  listScoutRunsResponseSchema,
  runScoutRequestSchema,
  runScoutResponseSchema,
  scoutErrorResponseSchema,
  trendFeedThemes,
} from "../../src/shared/trend-scout";

const completeRun: FeedRunResource = {
  id: "run_unit_1",
  themes: ["STREET_AND_DANCEHALL"],
  status: "COMPLETE",
  discoveredCount: 12,
  duplicateCount: 2,
  importedCount: 10,
  importedCandidateIds: ["cand_scout_a", "cand_scout_b"],
  startedAt: "2026-09-03T06:00:00.000Z",
  completedAt: "2026-09-03T06:01:00.000Z",
};

describe("trend feed contracts", () => {
  it("accepts every fixture feed and keeps at least 12 items per theme", () => {
    for (const theme of trendFeedThemes) {
      const feed = trendFeedFixtures[theme];
      expect(feed.theme).toBe(theme);
      expect(feed.items.length).toBeGreaterThanOrEqual(12);
      expect(feed.fetchedAt).toBe("2026-09-03T06:00:00.000Z");
    }
  });

  it("rejects a feed payload that drops below the minimum item count", () => {
    const broken = {
      ...trendFeedFixtures.MARKET_AND_HUSTLE,
      items: trendFeedFixtures.MARKET_AND_HUSTLE.items.slice(0, 5),
    };
    expect(() => parseAndNormalizeTrendFeed(broken)).toThrow();
  });

  it("keeps item content unique inside every themed feed", () => {
    for (const theme of trendFeedThemes) {
      const identities = new Set(
        trendFeedFixtures[theme].items.map(
          (item) => `${item.platform}::${item.caption}`,
        ),
      );
      expect(identities.size).toBe(trendFeedFixtures[theme].items.length);
    }
  });

  it("exercises realistic fit-checklist state across the fixtures", () => {
    const allChecklists = trendFeedThemes.flatMap((theme) =>
      trendFeedFixtures[theme].items.map((item) => item.fitChecklist),
    );
    expect(allChecklists.some((fit) => !fit.authorizedAudio)).toBe(true);
    expect(allChecklists.some((fit) => !fit.payoffWithinEightSeconds)).toBe(
      true,
    );
    expect(allChecklists.some((fit) => !fit.visuallySimple)).toBe(true);
    expect(
      allChecklists.every(
        (fit) => fit.clearPremise && fit.recognizableScenario,
      ),
    ).toBe(true);
  });

  it("round-trips run resources and scout API envelopes", () => {
    expect(feedRunResourceSchema.parse(completeRun).id).toBe("run_unit_1");
    expect(runScoutResponseSchema.parse({ run: completeRun }).run.id).toBe(
      "run_unit_1",
    );
    expect(
      listScoutRunsResponseSchema.parse({ runs: [completeRun] }).runs,
    ).toHaveLength(1);
    expect(latestScoutRunResponseSchema.parse({ run: null }).run).toBeNull();
    expect(
      runScoutRequestSchema.parse({ themes: ["YARD_AND_FAMILY"] }).themes,
    ).toEqual(["YARD_AND_FAMILY"]);
    expect(
      scoutErrorResponseSchema.parse({
        error: { code: "INVALID_REQUEST", message: "bad body" },
      }).error.code,
    ).toBe("INVALID_REQUEST");
  });
});

describe("trend item fingerprints", () => {
  it("is deterministic for the same content", () => {
    const item = { platform: "TIKTOK", caption: "Route taxi change sweep" };
    expect(computeTrendItemFingerprint(item)).toBe(
      computeTrendItemFingerprint(item),
    );
  });

  it("ignores casing and spacing drift between reposts", () => {
    expect(
      computeTrendItemFingerprint({
        platform: "INSTAGRAM",
        caption: "Di  CONDUCTOR   collects  fares",
      }),
    ).toBe(
      computeTrendItemFingerprint({
        platform: "INSTAGRAM",
        caption: "di conductor collects fares",
      }),
    );
  });

  it("separates the same caption on different platforms", () => {
    expect(
      computeTrendItemFingerprint({
        platform: "TIKTOK",
        caption: "same moment",
      }),
    ).not.toBe(
      computeTrendItemFingerprint({
        platform: "YOUTUBE",
        caption: "same moment",
      }),
    );
  });

  it("normalizes captions before hashing", () => {
    expect(normalizeTrendCaption("  Di   PEAR rolls ")).toBe("di pear rolls");
    expect(
      computeTrendCandidateFingerprint({
        platform: "OTHER",
        caption: "Jerk pan smoke",
      }),
    ).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("feed normalization and run planning", () => {
  it("normalizes every fixture item into a valid intake record", () => {
    const { feed, normalized } = parseAndNormalizeTrendFeed(
      trendFeedFixtures.STREET_AND_DANCEHALL,
    );
    expect(feed.items).toHaveLength(12);
    expect(normalized).toHaveLength(12);

    const first = normalized[0]!;
    expect(first.fingerprint).toBe(
      computeTrendItemFingerprint({
        platform: feed.items[0]!.platform,
        caption: feed.items[0]!.caption,
      }),
    );
    // The intake records must pass the exact contract the candidate
    // importer validates — that is the whole integration seam.
    expect(() =>
      candidateIntakeRecordSchema.parse(first.intakeRecord),
    ).not.toThrow();
    expect(first.intakeRecord.id).toBe(`cand_scout_${first.fingerprint}`);
    expect(Object.keys(first.intakeRecord)).not.toContain("scores");
  });

  it("plans a fresh run with zero duplicates", () => {
    const { normalized } = parseAndNormalizeTrendFeed(
      trendFeedFixtures.YARD_AND_FAMILY,
    );
    const plan = planTrendRun({
      normalizedByFeed: [normalized],
      knownFingerprints: new Set(),
    });
    expect(plan.discovered).toBe(12);
    expect(plan.duplicates).toBe(0);
    expect(plan.fresh).toHaveLength(12);
  });

  it("counts in-batch repeats and known moments as duplicates", () => {
    const { normalized } = parseAndNormalizeTrendFeed(
      trendFeedFixtures.WEATHER_AND_DAILY_GRIND,
    );
    const plan = planTrendRun({
      normalizedByFeed: [normalized, normalized],
      knownFingerprints: new Set([normalized[0]!.fingerprint]),
    });
    // 24 sightings: the first item is known, items 1-11 arrive twice as
    // fresh-then-duplicate, and the second copy of item 0 duplicates.
    expect(plan.discovered).toBe(24);
    expect(plan.duplicates).toBe(13);
    expect(plan.fresh).toHaveLength(11);
    expect(plan.fresh[0]!.fingerprint).toBe(normalized[1]!.fingerprint);
  });
});

describe("feed run presentation helpers", () => {
  it("labels run statuses and formats counts", () => {
    expect(feedRunStatusLabel("COMPLETE")).toBe("Complete");
    expect(feedRunStatusLabel("FAILED")).toBe("Failed");
    expect(describeFeedRunCounts(completeRun)).toBe(
      "12 discovered · 10 imported · 2 duplicates",
    );
    expect(describeFeedRunCounts({ ...completeRun, duplicateCount: 1 })).toBe(
      "12 discovered · 10 imported · 1 duplicate",
    );
  });

  it("formats human recency from an injected clock", () => {
    const completedMs = Date.parse("2026-09-03T12:00:00.000Z");
    const run = { ...completeRun, completedAt: "2026-09-03T12:00:00.000Z" };
    expect(formatScoutRunRecency(run, undefined)).toBe("");
    expect(formatScoutRunRecency(run, completedMs + 30_000)).toBe("just now");
    expect(formatScoutRunRecency(run, completedMs + 5 * 60_000)).toBe("5m ago");
    expect(formatScoutRunRecency(run, completedMs + 3 * 3_600_000)).toBe(
      "3h ago",
    );
    expect(formatScoutRunRecency(run, completedMs + 2 * 86_400_000)).toBe(
      "2d ago",
    );
    expect(formatScoutRunRecency(run, completedMs - 1)).toBe("");
  });

  it("keeps the TREND_FEED intake kind registered", () => {
    expect(candidateIntakeProviderKindSchema.parse("TREND_FEED")).toBe(
      "TREND_FEED",
    );
  });
});
