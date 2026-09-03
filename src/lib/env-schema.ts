import { z } from "zod";

const optionalSecret = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

const providerSettingKeys = {
  image: ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"],
  animation: ["RUNWAY_API_KEY", "RUNWAY_MODEL"],
} as const;

type ProviderSettingKey =
  (typeof providerSettingKeys)[keyof typeof providerSettingKeys][number];

function requireProviderSettings(
  environment: Partial<Record<ProviderSettingKey, string | undefined>>,
  context: z.RefinementCtx,
  selection: string,
  selectionKey: "IMAGE_PROVIDER" | "ANIMATION_PROVIDER",
  settingKeys: readonly ProviderSettingKey[],
): void {
  for (const key of settingKeys) {
    if (environment[key]) continue;

    context.addIssue({
      code: "custom",
      path: [key],
      message: `${key} is required when ${selectionKey}=${selection}`,
    });
  }
}

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.string().trim().min(1).default("file:./.data/yardtoonz.db"),
    ARTIFACT_ROOT: z.string().trim().min(1).default("./.data/artifacts"),
    IMAGE_PROVIDER: z.enum(["MOCK", "OPENAI"]).default("MOCK"),
    ANIMATION_PROVIDER: z.enum(["MOCK", "RUNWAY"]).default("MOCK"),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(100),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
    OPENAI_API_KEY: optionalSecret,
    OPENAI_IMAGE_MODEL: optionalSecret,
    RUNWAY_API_KEY: optionalSecret,
    RUNWAY_MODEL: optionalSecret,
  })
  .superRefine((environment, context) => {
    if (environment.IMAGE_PROVIDER === "OPENAI") {
      requireProviderSettings(
        environment,
        context,
        "OPENAI",
        "IMAGE_PROVIDER",
        providerSettingKeys.image,
      );
    }

    if (environment.ANIMATION_PROVIDER === "RUNWAY") {
      requireProviderSettings(
        environment,
        context,
        "RUNWAY",
        "ANIMATION_PROVIDER",
        providerSettingKeys.animation,
      );
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvSchema>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvSchema.parse(input);
}
