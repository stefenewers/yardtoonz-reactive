import "server-only";

import { trendFeedFixtures } from "@/../fixtures/trend-feeds";
import type { TrendFeedSourceKind, TrendFeedTheme } from "@/shared/trend-scout";
import { trendFeedThemes } from "@/shared/trend-scout";

/**
 * A Trend Feed Provider yields one themed feed snapshot as raw data. The
 * run service, not the provider, validates payloads against the Trend Feed
 * contract, so any future provider kind is held to the same Zod seam.
 * Providers are credential-free by contract and never contact a platform.
 */
export interface TrendFeedProvider {
  readonly kind: TrendFeedSourceKind;
  readonly theme: TrendFeedTheme;
  load(): unknown;
}

export function createFixtureTrendFeedProvider(
  theme: TrendFeedTheme,
): TrendFeedProvider {
  return {
    kind: "FIXTURE",
    theme,
    load: () => trendFeedFixtures[theme],
  };
}

/**
 * The demo registry: every theme backed by its deterministic fixture feed.
 */
export function createDefaultTrendFeedProviders(): TrendFeedProvider[] {
  return trendFeedThemes.map(createFixtureTrendFeedProvider);
}
