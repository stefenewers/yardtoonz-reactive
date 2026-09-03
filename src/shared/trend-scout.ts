import { z } from "zod";

import {
  engagementMetricsSchema,
  fitChecklistSchema,
  sourcePlatforms,
} from "./candidates";

/**
 * Trend Scout contracts. A feed is a themed, credential-free snapshot of
 * cultural moments; a run normalizes feed items into candidate intake
 * records and persists what happened. Nothing in this module talks to a
 * live platform — providers are fixture-backed by design.
 */

export const trendFeedThemes = [
  "STREET_AND_DANCEHALL",
  "WEATHER_AND_DAILY_GRIND",
  "MARKET_AND_HUSTLE",
  "YARD_AND_FAMILY",
] as const;
export const trendFeedThemeSchema = z.enum(trendFeedThemes);

export const trendFeedSourceKinds = ["FIXTURE"] as const;
export const trendFeedSourceKindSchema = z.enum(trendFeedSourceKinds);

/**
 * One cultural moment as the scout observed it. Feed identity is content
 * identity: the platform plus the caption. Two posts that present the same
 * caption are the same moment for dedupe purposes, so no platform post id
 * is carried here.
 */
export const trendFeedItemSchema = z
  .object({
    platform: z.enum(sourcePlatforms),
    sourceLabel: z.string().trim().min(1),
    caption: z.string().trim().min(1),
    publishedAt: z.iso.datetime(),
    observedAt: z.iso.datetime(),
    metrics: engagementMetricsSchema,
    commentExcerpts: z.array(z.string().trim().min(1)),
    adaptationNote: z.string().trim().min(1),
    fitChecklist: fitChecklistSchema,
  })
  .strict()
  .readonly();

export const minimumFeedItems = 12;

export const trendFeedSchema = z
  .object({
    theme: trendFeedThemeSchema,
    fetchedAt: z.iso.datetime(),
    items: z.array(trendFeedItemSchema).min(minimumFeedItems),
  })
  .strict()
  .readonly();

export const feedRunStatuses = ["COMPLETE", "FAILED"] as const;
export const feedRunStatusSchema = z.enum(feedRunStatuses);

export const feedRunErrorCodes = [
  "PROVIDER_INVALID_FEED",
  "INTAKE_REJECTED",
  "UNEXPECTED_ERROR",
] as const;
export const feedRunErrorCodeSchema = z.enum(feedRunErrorCodes);

export const feedRunResourceSchema = z
  .object({
    id: z.string().trim().min(1),
    themes: z.array(trendFeedThemeSchema).min(1),
    status: feedRunStatusSchema,
    discoveredCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    importedCount: z.number().int().nonnegative(),
    importedCandidateIds: z.array(z.string().trim().min(1)),
    errorCode: feedRunErrorCodeSchema.optional(),
    safeErrorMessage: z.string().trim().min(1).optional(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  })
  .strict()
  .readonly();

export const runScoutRequestSchema = z
  .object({ themes: z.array(trendFeedThemeSchema).min(1).optional() })
  .strict()
  .readonly();

export const runScoutResponseSchema = z
  .object({ run: feedRunResourceSchema })
  .strict()
  .readonly();

export const listScoutRunsResponseSchema = z
  .object({ runs: z.array(feedRunResourceSchema) })
  .strict()
  .readonly();

/** The latest run, or `run: null` before the first scout run. */
export const latestScoutRunResponseSchema = z
  .object({ run: feedRunResourceSchema.nullable() })
  .strict()
  .readonly();

export const scoutApiErrorCodes = [
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
] as const;
export const scoutErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(scoutApiErrorCodes),
      message: z.string().trim().min(1),
    }),
  })
  .strict()
  .readonly();

export const trendFeedThemeLabels: Record<TrendFeedTheme, string> = {
  STREET_AND_DANCEHALL: "Street & dancehall",
  WEATHER_AND_DAILY_GRIND: "Weather & the daily grind",
  MARKET_AND_HUSTLE: "Market & hustle",
  YARD_AND_FAMILY: "Yard & family",
};

export type TrendFeedTheme = z.infer<typeof trendFeedThemeSchema>;
export type TrendFeedSourceKind = z.infer<typeof trendFeedSourceKindSchema>;
export type TrendFeedItem = z.infer<typeof trendFeedItemSchema>;
export type TrendFeed = z.infer<typeof trendFeedSchema>;
export type FeedRunStatus = z.infer<typeof feedRunStatusSchema>;
export type FeedRunErrorCode = z.infer<typeof feedRunErrorCodeSchema>;
export type FeedRunResource = z.infer<typeof feedRunResourceSchema>;
export type RunScoutRequest = z.infer<typeof runScoutRequestSchema>;
export type RunScoutResponse = z.infer<typeof runScoutResponseSchema>;
export type ListScoutRunsResponse = z.infer<typeof listScoutRunsResponseSchema>;
