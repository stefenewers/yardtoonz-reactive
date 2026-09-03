import type { AnimationProvider, ImageProvider } from "@/lib/providers";

/**
 * Per-job provider credential gate: a production's PERSISTED provider
 * selections are validated at job creation so a live provider the
 * environment cannot serve is rejected up front instead of failing
 * mid-pipeline (possibly during a demo). Mock selections never require
 * credentials — the deterministic pipeline stays credential-free.
 *
 * This complements the startup environment schema, which only enforces
 * credentials for the environment's own default selections: a request that
 * selects a live provider explicitly must be checked against that provider's
 * settings even when the environment default is MOCK.
 */

export const providerCredentialsErrorCodes = [
  "PROVIDER_CREDENTIALS_REQUIRED",
] as const;

export type ProviderCredentialsErrorCode =
  (typeof providerCredentialsErrorCodes)[number];

/** Typed creation-gate failure listing the missing settings (names only). */
export class ProviderCredentialsError extends Error {
  constructor(
    public readonly code: ProviderCredentialsErrorCode,
    public readonly missingSettings: readonly string[],
  ) {
    super(
      `The selected provider requires settings that are not configured: ${missingSettings.join(", ")}.`,
    );
    this.name = "ProviderCredentialsError";
  }
}

/** Environment settings a selected live provider may require. */
export type ProviderCredentialEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_MODEL?: string;
  RUNWAY_API_KEY?: string;
  RUNWAY_MODEL?: string;
};

const requiredSettingsByProvider = {
  OPENAI: ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"],
  RUNWAY: ["RUNWAY_API_KEY", "RUNWAY_MODEL"],
} as const satisfies Partial<
  Record<ImageProvider | AnimationProvider, readonly string[]>
>;

/**
 * Pure validation: fails fast only when a LIVE provider is selected and its
 * credentials are absent. Blank strings count as absent, matching the
 * environment schema's optional-secret handling.
 */
export function assertProviderCredentials(
  selection: {
    readonly imageProvider: ImageProvider;
    readonly animationProvider: AnimationProvider;
  },
  environment: ProviderCredentialEnvironment,
): void {
  const missing: string[] = [];

  const imageSettings =
    selection.imageProvider === "OPENAI"
      ? requiredSettingsByProvider.OPENAI
      : undefined;
  for (const setting of imageSettings ?? []) {
    if (!environment[setting]?.trim()) missing.push(setting);
  }

  const animationSettings =
    selection.animationProvider === "RUNWAY"
      ? requiredSettingsByProvider.RUNWAY
      : undefined;
  for (const setting of animationSettings ?? []) {
    if (!environment[setting]?.trim()) missing.push(setting);
  }

  if (missing.length > 0) {
    throw new ProviderCredentialsError(
      "PROVIDER_CREDENTIALS_REQUIRED",
      missing,
    );
  }
}
