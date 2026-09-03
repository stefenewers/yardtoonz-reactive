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
