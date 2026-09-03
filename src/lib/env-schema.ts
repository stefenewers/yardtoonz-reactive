import { z } from "zod";

const optionalSecret = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.string().trim().min(1).default("file:./.data/yardtoonz.db"),
    ARTIFACT_ROOT: z.string().trim().min(1).default("./.data/artifacts"),
    PROVIDER_MODE: z.enum(["MOCK", "LIVE"]).default("MOCK"),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(100),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
    OPENAI_API_KEY: optionalSecret,
    OPENAI_IMAGE_MODEL: optionalSecret,
    RUNWAY_API_KEY: optionalSecret,
    RUNWAY_MODEL: optionalSecret,
  })
  .superRefine((environment, context) => {
    if (environment.PROVIDER_MODE !== "LIVE") return;

    for (const key of [
      "OPENAI_API_KEY",
      "OPENAI_IMAGE_MODEL",
      "RUNWAY_API_KEY",
      "RUNWAY_MODEL",
    ] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when PROVIDER_MODE=LIVE`,
        });
      }
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvSchema>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvSchema.parse(input);
}
