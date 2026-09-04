import type {
  DiagnosticsArtifact,
  DiagnosticsCredentialSetting,
  DiagnosticsEnvironment,
  DiagnosticsJob,
} from "../shared/diagnostics";
import type { ArtifactProvider } from "../lib/providers";
import {
  productionStageNames,
  type ProductionStageName,
} from "../shared/productions";

/**
 * Pure view-model for the provider diagnostics surface. The component renders
 * whatever these functions return, so credential-gate explainers, the
 * attribution audit, and request-ID timelines stay independently testable
 * (AGENTS.md: domain transformations are pure).
 */

export type ProviderFamily = "image" | "animation" | "director";

export const providerFamilyLabels: Record<ProviderFamily, string> = {
  image: "Image provider",
  animation: "Animation provider",
  director: "Director provider",
};

/** What the fail-fast creation gate would do for each selection right now. */
export type CredentialGateOutcome =
  /** Mock selection: no credential is consulted, the pipeline stays local. */
  | "CREDENTIAL_FREE"
  /** Live selection with every required setting present: creation proceeds. */
  | "READY"
  /** Live selection missing settings: creation rejects before any work runs. */
  | "FAILS_FAST";

export interface CredentialGateState {
  readonly family: ProviderFamily;
  readonly familyLabel: string;
  readonly selectedProvider: "MOCK" | "OPENAI" | "RUNWAY";
  readonly selectedLabel: string;
  readonly isLive: boolean;
  /** Required settings for the live selection; empty for mock. */
  readonly requiredSettings: readonly string[];
  readonly presentSettings: readonly string[];
  readonly missingSettings: readonly string[];
  readonly outcome: CredentialGateOutcome;
  readonly outcomeLabel: string;
}

const providerLabels: Record<ArtifactProvider, string> = {
  MOCK: "Mock (local)",
  OPENAI: "OpenAI (live)",
  RUNWAY: "Runway (live)",
  USER_UPLOAD: "Upload (local)",
  FFMPEG: "FFmpeg (local)",
};

const outcomeLabels: Record<CredentialGateOutcome, string> = {
  CREDENTIAL_FREE: "Credential-free",
  READY: "Credentials ready",
  FAILS_FAST: "Fails fast — missing settings",
};

const requiredSettingsByFamily: Record<
  ProviderFamily,
  readonly DiagnosticsCredentialSetting[]
> = {
  image: ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"],
  animation: ["RUNWAY_API_KEY", "RUNWAY_MODEL"],
  director: ["OPENAI_API_KEY", "OPENAI_DIRECTOR_MODEL"],
};

const selectedProviderByFamily: Record<
  ProviderFamily,
  (
    environment: DiagnosticsEnvironment,
  ) => CredentialGateState["selectedProvider"]
> = {
  image: (environment) => environment.imageProvider,
  animation: (environment) => environment.animationProvider,
  director: (environment) => environment.directorProvider,
};

/**
 * Fail-fast explainer for all three selection families. Mirrors the
 * environment schema and the per-job creation gate: a live selection is
 * servable only when every required setting is present; mock never demands
 * credentials. Setting NAMES are surfaced, values never are.
 */
export function buildCredentialGateStates(
  environment: DiagnosticsEnvironment,
): CredentialGateState[] {
  const families: ProviderFamily[] = ["image", "animation", "director"];

  return families.map((family) => {
    const selectedProvider = selectedProviderByFamily[family](environment);
    const isLive = selectedProvider !== "MOCK";
    const requiredSettings = isLive ? requiredSettingsByFamily[family] : [];
    const missingSettings = requiredSettings.filter(
      (setting) => !environment.credentials[setting],
    );
    const presentSettings = requiredSettings.filter(
      (setting) => environment.credentials[setting],
    );

    const outcome: CredentialGateOutcome = !isLive
      ? "CREDENTIAL_FREE"
      : missingSettings.length === 0
        ? "READY"
        : "FAILS_FAST";

    return Object.freeze({
      family,
      familyLabel: providerFamilyLabels[family],
      selectedProvider,
      selectedLabel: providerLabels[selectedProvider],
      isLive,
      requiredSettings,
      presentSettings,
      missingSettings,
      outcome,
      outcomeLabel: outcomeLabels[outcome],
    });
  });
}

export interface ProviderStatusCard {
  readonly productionId: string;
  readonly candidateId: string;
  readonly status: string;
  readonly attempt: number;
  readonly imageProviderLabel: string;
  readonly animationProviderLabel: string;
  readonly updatedAt: string;
  readonly artifactCount: number;
  readonly liveAttributedCount: number;
  readonly localCount: number;
  readonly unattributedLiveCount: number;
  /**
   * False when a persisted live selection can no longer be served by the
   * environment (credentials were removed after creation) — informational,
   * the persisted job itself is never re-gated.
   */
  readonly environmentStillServable: boolean;
}

/**
 * One card per persisted production: its frozen provider pair and a live
 * count of how completely its artifacts carry attribution.
 */
export function buildProviderStatusCards(
  jobs: readonly DiagnosticsJob[],
  environment: DiagnosticsEnvironment,
): ProviderStatusCard[] {
  return jobs.map((job) => {
    const live = job.artifacts.filter(
      (artifact) =>
        artifact.provider === "OPENAI" || artifact.provider === "RUNWAY",
    );
    const liveAttributedCount = live.filter(
      (artifact) => artifact.providerRequestId !== undefined,
    ).length;
    const unattributedLiveCount = live.length - liveAttributedCount;
    const localCount = job.artifacts.length - live.length;

    const imageServable =
      job.imageProvider === "MOCK" ||
      requiredSettingsByFamily.image.every(
        (setting) => environment.credentials[setting],
      );
    const animationServable =
      job.animationProvider === "MOCK" ||
      requiredSettingsByFamily.animation.every(
        (setting) => environment.credentials[setting],
      );

    return Object.freeze({
      productionId: job.id,
      candidateId: job.candidateId,
      status: job.status,
      attempt: job.attempt,
      imageProviderLabel: providerLabels[job.imageProvider],
      animationProviderLabel: providerLabels[job.animationProvider],
      updatedAt: job.updatedAt,
      artifactCount: job.artifacts.length,
      liveAttributedCount,
      localCount,
      unattributedLiveCount,
      environmentStillServable: imageServable && animationServable,
    });
  });
}

/** Live producers owe a provider request ID; local producers do not. */
export function isLiveProvider(provider: ArtifactProvider): boolean {
  return provider === "OPENAI" || provider === "RUNWAY";
}

export type AttributionVerdict =
  /** Live-produced artifact carrying its provider request ID. */
  | "LIVE_ATTRIBUTED"
  /** Local producer (upload, FFmpeg, or mock): no request ID is expected. */
  | "LOCAL"
  /** Audit failure: a live provider produced the artifact without a request ID. */
  | "UNATTRIBUTED_LIVE";

export interface AttributionRow {
  readonly productionId: string;
  readonly artifactId: string;
  readonly kindLabel: string;
  readonly providerLabel: string;
  readonly providerRequestId?: string;
  readonly createdAt: string;
  readonly verdict: AttributionVerdict;
  readonly verdictLabel: string;
}

export interface AttributionAudit {
  readonly rows: readonly AttributionRow[];
  readonly totals: {
    readonly artifacts: number;
    readonly liveAttributed: number;
    readonly local: number;
    readonly unattributedLive: number;
  };
  /** True when every live-produced artifact carries its request ID. */
  readonly complete: boolean;
}

const artifactKindLabels: Record<DiagnosticsArtifact["kind"], string> = {
  SOURCE_VIDEO: "Source video",
  EXTRACTED_CLIP: "Extracted clip",
  EXTRACTED_AUDIO: "Extracted audio",
  KEYFRAME: "Keyframe",
  STYLED_FRAME: "Styled frame",
  SILENT_ANIMATION: "Silent animation",
  FINAL_VIDEO: "Final video",
};

const verdictLabels: Record<AttributionVerdict, string> = {
  LIVE_ATTRIBUTED: "Attributed",
  LOCAL: "Local producer",
  UNATTRIBUTED_LIVE: "Missing request ID",
};

/**
 * Every artifact across every job with its producing provider and request-ID
 * lineage, newest first. Mock, upload, and FFmpeg outputs are attributed to
 * their local producer; they never claim a live provider made them.
 */
export function buildAttributionAudit(
  jobs: readonly DiagnosticsJob[],
): AttributionAudit {
  const rows: AttributionRow[] = [];

  for (const job of jobs) {
    for (const artifact of job.artifacts) {
      const isLive = isLiveProvider(artifact.provider);
      const verdict: AttributionVerdict = !isLive
        ? "LOCAL"
        : artifact.providerRequestId !== undefined
          ? "LIVE_ATTRIBUTED"
          : "UNATTRIBUTED_LIVE";

      rows.push(
        Object.freeze({
          productionId: job.id,
          artifactId: artifact.id,
          kindLabel: artifactKindLabels[artifact.kind],
          providerLabel: providerLabels[artifact.provider],
          providerRequestId: artifact.providerRequestId,
          createdAt: artifact.createdAt,
          verdict,
          verdictLabel: verdictLabels[verdict],
        }),
      );
    }
  }

  rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const totals = {
    artifacts: rows.length,
    liveAttributed: rows.filter((row) => row.verdict === "LIVE_ATTRIBUTED")
      .length,
    local: rows.filter((row) => row.verdict === "LOCAL").length,
    unattributedLive: rows.filter((row) => row.verdict === "UNATTRIBUTED_LIVE")
      .length,
  };

  return Object.freeze({
    rows: Object.freeze(rows),
    totals,
    complete: totals.unattributedLive === 0,
  });
}

export interface RequestIdEvent {
  /** Observation time: stage completion (or start) or artifact creation. */
  readonly at: string;
  readonly source: "stage" | "artifact";
  readonly sourceLabel: string;
  readonly detailLabel: string;
  readonly providerLabel: string;
  readonly providerRequestId?: string;
  readonly hasRequestId: boolean;
}

const stageNameLabels: Record<ProductionStageName, string> = Object.freeze(
  Object.fromEntries(
    productionStageNames.map((name) => [
      name,
      name
        .toLowerCase()
        .replace(/(^|_)([a-z])/g, (_, separator, letter: string) =>
          separator ? ` ${letter.toUpperCase()}` : letter.toUpperCase(),
        ),
    ]),
  ),
) as Record<ProductionStageName, string>;

/**
 * Chronological request-ID timeline for one job: every observed event that
 * carries (or would carry) provider request lineage — completed/failed
 * stages and produced artifacts. Waiting stages have no observation time
 * and stay off the timeline.
 */
export function buildRequestIdTimeline(
  job: DiagnosticsJob,
): readonly RequestIdEvent[] {
  const events: RequestIdEvent[] = [];

  for (const stage of job.stages) {
    if (stage.status === "WAITING") continue;
    const at = stage.completedAt ?? stage.startedAt;
    if (!at) continue;

    events.push(
      Object.freeze({
        at,
        source: "stage",
        sourceLabel: "Stage",
        detailLabel: stageNameLabels[stage.name],
        providerLabel: stage.providerRequestId ? "Live" : "Local/mock",
        providerRequestId: stage.providerRequestId,
        hasRequestId: stage.providerRequestId !== undefined,
      }),
    );
  }

  for (const artifact of job.artifacts) {
    events.push(
      Object.freeze({
        at: artifact.createdAt,
        source: "artifact",
        sourceLabel: "Artifact",
        detailLabel: artifactKindLabels[artifact.kind],
        providerLabel: providerLabels[artifact.provider],
        providerRequestId: artifact.providerRequestId,
        hasRequestId: artifact.providerRequestId !== undefined,
      }),
    );
  }

  events.sort((left, right) => left.at.localeCompare(right.at));
  return Object.freeze(events);
}
