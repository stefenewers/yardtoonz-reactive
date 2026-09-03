export const imageProviders = ["MOCK", "OPENAI"] as const;
export type ImageProvider = (typeof imageProviders)[number];

export const animationProviders = ["MOCK", "RUNWAY"] as const;
export type AnimationProvider = (typeof animationProviders)[number];

export const artifactProviders = [
  "USER_UPLOAD",
  "FFMPEG",
  "MOCK",
  "OPENAI",
  "RUNWAY",
] as const;
export type ArtifactProvider = (typeof artifactProviders)[number];

/**
 * Director treatment providers. Only the deterministic MOCK service exists
 * today; live structured-output mode requires explicit approval before it
 * is wired (AGENTS.md live-provider constraint).
 */
export const directorProviders = ["MOCK"] as const;
export type DirectorProvider = (typeof directorProviders)[number];

/**
 * Provider contract for the STYLE_IMAGE stage (Technical Specification §5).
 * Implementations style one keyframe image and report the provider request ID
 * when the producing provider issued one, so it can be persisted on the
 * resulting artifact record.
 */
export interface ImageStyleProvider {
  readonly name: string;
  style(input: {
    keyframePath: string;
    prompt: string;
    productionId: string;
  }): Promise<{ outputPath: string; requestId?: string }>;
}
