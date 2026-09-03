import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, describe, expect, it } from "vitest";

import { trendFeedFixtures } from "../../fixtures/trend-feeds";
import { parseAndNormalizeTrendFeed } from "../../src/domain/trend-scout";
import { candidateIntakeRecordSchema } from "../../src/shared/candidate-intake";
import { createTrendFeedCandidateIntakeProvider } from "../../src/server/candidates/intake";
import {
  createCandidateRepository,
  type CandidateRepository,
} from "../../src/server/candidates/repository";
import * as schema from "../../src/server/db/schema";
import {
  createFeedRunRepository,
  type FeedRunRepository,
} from "../../src/server/scout/feed-run-repository";
import {
  createScoutRunService,
  type ScoutRunService,
} from "../../src/server/scout/run-service";
import type { TrendFeedProvider } from "../../src/server/scout/feed-providers";
import { feedRunResourceSchema } from "../../src/shared/trend-scout";

type Harness = {
  service: ScoutRunService;
  feedRuns: FeedRunRepository;
  candidates: CandidateRepository;
};

const openDatabases: Database.Database[] = [];
const cleanupDirectories: string[] = [];

afterAll(async () => {
  for (const database of openDatabases) database.close();
  await Promise.all(
    cleanupDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createHarness(providers: TrendFeedProvider[]): Promise<Harness> {
  const workspace = await mkdtemp(path.join(tmpdir(), "yardtoonz-scout-"));
  cleanupDirectories.push(workspace);
  const sqlite = new Database(":memory:");
  openDatabases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });

  const candidates = createCandidateRepository(database);
  const feedRunRepository = createFeedRunRepository(database);
  let tick = 0;
  const service = createScoutRunService({
    feedRunRepository,
    candidateRepository: candidates,
    providers,
    now: () => new Date(Date.parse("2026-09-03T12:00:00.000Z") + tick++ * 1000),
  });
  return { service, feedRuns: feedRunRepository, candidates };
}

const defaultProviders = (): TrendFeedProvider[] =>
  Object.values(trendFeedFixtures).map((feed) => ({
    kind: "FIXTURE" as const,
    theme: feed.theme,
    load: () => feed,
  }));

function brokenFeedProvider(theme: "MARKET_AND_HUSTLE"): TrendFeedProvider {
  const feed = trendFeedFixtures[theme];
  return {
    kind: "FIXTURE",
    theme,
    load: () => ({ ...feed, items: feed.items.slice(0, 5) }),
  };
}

function explodingProvider(
  theme: "WEATHER_AND_DAILY_GRIND",
): TrendFeedProvider {
  return {
    kind: "FIXTURE",
    theme,
    load: () => {
      throw new Error("fixture storage offline");
    },
  };
}

const themesOf = (providers: TrendFeedProvider[]) =>
  providers.map((provider) => provider.theme);

describe("scout run service", () => {
  it("imports every fixture moment as a scored candidate on the first run", async () => {
    const harness = await createHarness(defaultProviders());
    const run = await harness.service.run();
    expect(run.themes).toEqual(themesOf(defaultProviders()));
    expect(run.status).toBe("COMPLETE");
    expect(run.discoveredCount).toBe(48);
    expect(run.duplicateCount).toBe(0);
    expect(run.importedCount).toBe(48);
    expect(run.importedCandidateIds).toHaveLength(48);
    expect(run.startedAt).toBe("2026-09-03T12:00:00.000Z");
    expect(run.completedAt).toBe("2026-09-03T12:00:01.000Z");

    // Feed-run to candidates integration: every imported id exists in the
    // candidate repository as a NEW scored candidate.
    const inbox = harness.candidates.list();
    const imported = inbox.filter((candidate) =>
      candidate.id.startsWith("cand_scout_"),
    );
    expect(imported).toHaveLength(48);
    for (const candidate of imported) {
      expect(candidate.status).toBe("NEW");
      expect(candidate.scores.overall).toBeGreaterThanOrEqual(0);
    }
    const runCandidateIds = new Set(run.importedCandidateIds);
    for (const candidate of imported) {
      expect(runCandidateIds.has(candidate.id)).toBe(true);
    }
  });

  it("deduplicates the same fixture moments on a second run", async () => {
    const harness = await createHarness(defaultProviders());
    const first = await harness.service.run();
    expect(first.importedCount).toBe(48);

    const second = await harness.service.run();
    expect(second.status).toBe("COMPLETE");
    expect(second.discoveredCount).toBe(48);
    expect(second.duplicateCount).toBe(48);
    expect(second.importedCount).toBe(0);
    expect(second.importedCandidateIds).toEqual([]);
    expect(harness.candidates.list()).toHaveLength(48);
  });

  it("imports only the requested themes and records them on the run", async () => {
    const harness = await createHarness(defaultProviders());
    const run = await harness.service.run({ themes: ["YARD_AND_FAMILY"] });
    expect(run.themes).toEqual(["YARD_AND_FAMILY"]);
    expect(run.discoveredCount).toBe(12);
    expect(run.importedCount).toBe(12);

    // A themed pass after a full pass is fully duplicate.
    await harness.service.run();
    const themed = await harness.service.run({ themes: ["YARD_AND_FAMILY"] });
    expect(themed.duplicateCount).toBe(12);
    expect(themed.importedCount).toBe(0);
  });

  it("persists runs and lists them newest first", async () => {
    const harness = await createHarness(defaultProviders());
    await harness.service.run({ themes: ["YARD_AND_FAMILY"] });
    await harness.service.run({ themes: ["MARKET_AND_HUSTLE"] });

    const runs = await harness.feedRuns.list();
    expect(runs).toHaveLength(2);
    expect(runs[0]!.themes).toEqual(["MARKET_AND_HUSTLE"]);
    expect(runs[1]!.themes).toEqual(["YARD_AND_FAMILY"]);
    for (const run of runs) {
      expect(() => feedRunResourceSchema.parse(run)).not.toThrow();
    }
    expect((await harness.feedRuns.latest())?.themes).toEqual([
      "MARKET_AND_HUSTLE",
    ]);
  });

  it("fails safely and persists the failure when a feed is malformed", async () => {
    const providers = defaultProviders().map((provider) =>
      provider.theme === "MARKET_AND_HUSTLE"
        ? brokenFeedProvider("MARKET_AND_HUSTLE")
        : provider,
    );
    const harness = await createHarness(providers);
    const run = await harness.service.run();
    expect(run.status).toBe("FAILED");
    expect(run.safeErrorMessage).toBe(
      "MARKET_AND_HUSTLE did not match the Trend Feed contract: items: Too small: expected array to have >=12 items",
    );
    expect(run.discoveredCount).toBe(0);
    expect(run.importedCount).toBe(0);
    // Nothing was imported before the provider was validated.
    const inbox = harness.candidates.list();
    expect(
      inbox.filter((candidate) => candidate.id.startsWith("cand_scout_")),
    ).toHaveLength(0);
    // The failure itself is persisted so the header can report it.
    expect(await harness.feedRuns.list()).toHaveLength(1);
    expect((await harness.feedRuns.latest())?.status).toBe("FAILED");
  });

  it("classifies non-contract provider failures as unexpected", async () => {
    const providers = defaultProviders().map((provider) =>
      provider.theme === "WEATHER_AND_DAILY_GRIND"
        ? explodingProvider("WEATHER_AND_DAILY_GRIND")
        : provider,
    );
    const harness = await createHarness(providers);
    const run = await harness.service.run();
    expect(run.status).toBe("FAILED");
    expect(run.safeErrorMessage).toBe(
      "Scout run failed while reading the WEATHER_AND_DAILY_GRIND feed.",
    );
    expect(
      harness.candidates
        .list()
        .filter((candidate) => candidate.id.startsWith("cand_scout_")),
    ).toHaveLength(0);
  });

  it("feeds intake records through the TREND_FEED provider contract", async () => {
    const { normalized } = parseAndNormalizeTrendFeed(
      trendFeedFixtures.MARKET_AND_HUSTLE,
    );
    const provider = createTrendFeedCandidateIntakeProvider(
      normalized.map(({ intakeRecord }) => intakeRecord),
    );
    expect(provider.kind).toBe("TREND_FEED");
    const records = provider.load();
    expect(records).toHaveLength(12);
    for (const record of records) {
      expect(() => candidateIntakeRecordSchema.parse(record)).not.toThrow();
    }
  });
});
