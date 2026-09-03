import type { AnimationProvider, ImageProvider } from "@/lib/providers";

import type { Candidate, CandidateListOptions } from "./candidate";
import { scoringWeights } from "./scoring";

/**
 * Client-side view of the persisted candidate list sort contract
 * (`candidateListQuerySchema` in shared/candidates). The workspace keeps one
 * sort state and passes it straight to the persisted API.
 */
export interface InboxSortState {
  field: CandidateSortField;
  order: CandidateSortOrder;
}

export type CandidateSortField =
  | "overall"
  | "viralMomentum"
  | "humorResponse"
  | "yardToonzFit";
export type CandidateSortOrder = "asc" | "desc";

export const defaultInboxSort: InboxSortState = {
  field: "overall",
  order: "desc",
};

export const sortFieldLabels: Record<CandidateSortField, string> = {
  overall: "overall score",
  viralMomentum: "viral momentum",
  humorResponse: "humor response",
  yardToonzFit: "Yard Toonz fit",
};

export const platformLabels: Record<Candidate["platform"], string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  OTHER: "Other",
};

export function nextSortState(
  field: CandidateSortField,
  current: InboxSortState,
): InboxSortState {
  if (current.field === field) {
    return { field, order: current.order === "desc" ? "asc" : "desc" };
  }
  return { field, order: "desc" };
}

export function sortDescription(sort: InboxSortState): string {
  return `sorted by ${sortFieldLabels[sort.field]}, ${
    sort.order === "desc" ? "highest" : "lowest"
  } first`;
}

/**
 * Mirrors the persisted repository's deterministic ordering (score, then
 * stable id tie-break) for the mock client so both clients rank identically.
 */
export function sortCandidates(
  candidates: Candidate[],
  options: CandidateListOptions = {},
): Candidate[] {
  const field = options.sort ?? "overall";
  const direction = options.order === "asc" ? 1 : -1;
  const scoreOf = (candidate: Candidate) =>
    field === "overall"
      ? candidate.scores.overall
      : candidate.scores[field].score;

  return [...candidates].sort(
    (left, right) =>
      direction * (scoreOf(left) - scoreOf(right)) ||
      left.id.localeCompare(right.id),
  );
}

export function formatSourceAge(
  publishedAt: string | undefined,
  nowMs: number | undefined,
): string {
  if (publishedAt === undefined || nowMs === undefined) {
    return "Age not supplied";
  }
  const publishedMs = new Date(publishedAt).getTime();
  const ageMs = nowMs - publishedMs;
  if (!Number.isFinite(publishedMs) || ageMs < 0) return "Age not supplied";

  const ageHours = Math.floor(ageMs / 3_600_000);
  if (ageHours < 48) return `${Math.max(ageHours, 1)}h`;
  const ageDays = Math.floor(ageHours / 24);
  if (ageDays < 14) return `${ageDays}d`;
  return `${Math.floor(ageDays / 7)}w`;
}

export function humanizeProvider(
  provider: ImageProvider | AnimationProvider,
): string {
  switch (provider) {
    case "MOCK":
      return "Mock";
    case "OPENAI":
      return "OpenAI (live)";
    case "RUNWAY":
      return "Runway (live)";
  }
}

export function providerModeLabel(
  image: ImageProvider,
  animation: AnimationProvider,
): "Mock mode" | "Live mode" | "Hybrid mode" {
  if (image === "MOCK" && animation === "MOCK") return "Mock mode";
  if (image !== "MOCK" && animation !== "MOCK") return "Live mode";
  return "Hybrid mode";
}

/** Built from `scoringWeights` so the UI can never drift from the scorer. */
export function overallWeightingSummary(): string {
  const percent = (weight: number) => `${Math.round(weight * 100)}%`;
  return `Overall = ${percent(scoringWeights.viralMomentum)} viral momentum + ${percent(
    scoringWeights.humorResponse,
  )} humor response + ${percent(scoringWeights.yardToonzFit)} Yard Toonz fit`;
}

export type HealthTone = "ok" | "degraded" | "unavailable" | "pending";

export function healthDisplay(
  report: { status: "ok" | "degraded" } | undefined,
  failed: boolean,
): { label: string; tone: HealthTone } {
  if (report) {
    return report.status === "ok"
      ? { label: "System ready", tone: "ok" }
      : { label: "System degraded", tone: "degraded" };
  }
  if (failed) return { label: "Health unavailable", tone: "unavailable" };
  return { label: "Checking health…", tone: "pending" };
}
