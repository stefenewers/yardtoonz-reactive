import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "../../src/lib/env-schema";

const openAiSettings = {
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_IMAGE_MODEL: "test-image-model",
};
const runwaySettings = {
  RUNWAY_API_KEY: "test-runway-key",
  RUNWAY_MODEL: "test-animation-model",
};
const openAiDirectorSettings = {
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_DIRECTOR_MODEL: "test-director-model",
};

function getConfigurationError(
  input: Record<string, string | undefined>,
): string {
  try {
    parseServerEnvironment(input);
    return "configuration unexpectedly passed validation";
  } catch (error: unknown) {
    return String(error);
  }
}

describe("parseServerEnvironment", () => {
  it("uses credential-free mock/mock defaults", () => {
    expect(parseServerEnvironment({})).toMatchObject({
      IMAGE_PROVIDER: "MOCK",
      ANIMATION_PROVIDER: "MOCK",
      MAX_UPLOAD_MB: 100,
      WORKER_POLL_MS: 1000,
    });
  });

  it("accepts an OpenAI image provider with mock animation", () => {
    expect(
      parseServerEnvironment({
        IMAGE_PROVIDER: "OPENAI",
        ANIMATION_PROVIDER: "MOCK",
        ...openAiSettings,
      }),
    ).toMatchObject({ IMAGE_PROVIDER: "OPENAI", ANIMATION_PROVIDER: "MOCK" });
  });

  it("accepts a mock image provider with Runway animation", () => {
    expect(
      parseServerEnvironment({
        IMAGE_PROVIDER: "MOCK",
        ANIMATION_PROVIDER: "RUNWAY",
        ...runwaySettings,
      }),
    ).toMatchObject({ IMAGE_PROVIDER: "MOCK", ANIMATION_PROVIDER: "RUNWAY" });
  });

  it("accepts fully live provider selections", () => {
    expect(
      parseServerEnvironment({
        IMAGE_PROVIDER: "OPENAI",
        ANIMATION_PROVIDER: "RUNWAY",
        ...openAiSettings,
        ...runwaySettings,
      }),
    ).toMatchObject({ IMAGE_PROVIDER: "OPENAI", ANIMATION_PROVIDER: "RUNWAY" });
  });

  it("requires only the selected image provider settings", () => {
    const message = getConfigurationError({ IMAGE_PROVIDER: "OPENAI" });

    expect(message).toContain(
      "OPENAI_API_KEY is required when IMAGE_PROVIDER=OPENAI",
    );
    expect(message).toContain(
      "OPENAI_IMAGE_MODEL is required when IMAGE_PROVIDER=OPENAI",
    );
    expect(message).not.toContain("RUNWAY_API_KEY is required");
  });

  it("requires only the selected animation provider settings", () => {
    const message = getConfigurationError({ ANIMATION_PROVIDER: "RUNWAY" });

    expect(message).toContain(
      "RUNWAY_API_KEY is required when ANIMATION_PROVIDER=RUNWAY",
    );
    expect(message).toContain(
      "RUNWAY_MODEL is required when ANIMATION_PROVIDER=RUNWAY",
    );
    expect(message).not.toContain("OPENAI_API_KEY is required");
  });

  it("rejects invalid positive integer settings", () => {
    expect(() => parseServerEnvironment({ MAX_UPLOAD_MB: "0" })).toThrow();
    expect(() => parseServerEnvironment({ WORKER_POLL_MS: "1.5" })).toThrow();
  });

  it("keeps the credential-free mock director default", () => {
    expect(parseServerEnvironment({})).toMatchObject({
      DIRECTOR_PROVIDER: "MOCK",
    });
  });

  it("accepts an OpenAI director provider with required settings", () => {
    expect(
      parseServerEnvironment({
        DIRECTOR_PROVIDER: "OPENAI",
        ...openAiDirectorSettings,
      }),
    ).toMatchObject({ DIRECTOR_PROVIDER: "OPENAI" });
  });

  it("requires only the selected director provider settings", () => {
    const message = getConfigurationError({ DIRECTOR_PROVIDER: "OPENAI" });

    expect(message).toContain(
      "OPENAI_API_KEY is required when DIRECTOR_PROVIDER=OPENAI",
    );
    expect(message).toContain(
      "OPENAI_DIRECTOR_MODEL is required when DIRECTOR_PROVIDER=OPENAI",
    );
    expect(message).not.toContain("RUNWAY_API_KEY is required");
  });

  it("rejects an unknown director provider selection", () => {
    const message = getConfigurationError({
      DIRECTOR_PROVIDER: "ANTHROPIC",
      ...openAiDirectorSettings,
    });

    expect(message).toContain("DIRECTOR_PROVIDER");
  });

  it("does not require director credentials for image or animation selections", () => {
    expect(
      parseServerEnvironment({
        IMAGE_PROVIDER: "OPENAI",
        ANIMATION_PROVIDER: "RUNWAY",
        ...openAiSettings,
        ...runwaySettings,
      }),
    ).toMatchObject({ DIRECTOR_PROVIDER: "MOCK" });
  });
});
