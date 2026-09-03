import { describe, expect, it } from "vitest";

import {
  ProviderCredentialsError,
  assertProviderCredentials,
} from "../../src/server/productions/provider-credentials";

const mockSelection = {
  imageProvider: "MOCK",
  animationProvider: "MOCK",
} as const;
const openAICredentials = {
  OPENAI_API_KEY: "key-present",
  OPENAI_IMAGE_MODEL: "gpt-image-1",
};
const runwayCredentials = {
  RUNWAY_API_KEY: "key-present",
  RUNWAY_MODEL: "gen4_turbo",
};

describe("assertProviderCredentials", () => {
  it("accepts mock selections without any credentials", () => {
    expect(() => assertProviderCredentials(mockSelection, {})).not.toThrow();
  });

  it("accepts a live selection when every required setting is present", () => {
    expect(() =>
      assertProviderCredentials(
        { imageProvider: "OPENAI", animationProvider: "RUNWAY" },
        { ...openAICredentials, ...runwayCredentials },
      ),
    ).not.toThrow();
  });

  it("fails fast when OPENAI is selected without credentials", () => {
    try {
      assertProviderCredentials(
        { imageProvider: "OPENAI", animationProvider: "MOCK" },
        {},
      );
      expect.unreachable("validation must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderCredentialsError);
      const failure = error as ProviderCredentialsError;
      expect(failure.code).toBe("PROVIDER_CREDENTIALS_REQUIRED");
      expect([...failure.missingSettings]).toEqual([
        "OPENAI_API_KEY",
        "OPENAI_IMAGE_MODEL",
      ]);
    }
  });

  it("fails fast when RUNWAY is selected without credentials", () => {
    try {
      assertProviderCredentials(
        { imageProvider: "MOCK", animationProvider: "RUNWAY" },
        {},
      );
      expect.unreachable("validation must throw");
    } catch (error) {
      const failure = error as ProviderCredentialsError;
      expect(failure.code).toBe("PROVIDER_CREDENTIALS_REQUIRED");
      expect([...failure.missingSettings]).toEqual([
        "RUNWAY_API_KEY",
        "RUNWAY_MODEL",
      ]);
    }
  });

  it("treats blank settings as absent and never echoes values", () => {
    const secretValue = "super-secret-do-not-echo";
    try {
      assertProviderCredentials(
        { imageProvider: "OPENAI", animationProvider: "MOCK" },
        { OPENAI_API_KEY: "  ", OPENAI_IMAGE_MODEL: secretValue },
      );
      expect.unreachable("validation must throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("OPENAI_API_KEY");
      expect(message).not.toContain(secretValue);
    }
  });

  it("ignores live-provider settings for mock selections", () => {
    // A half-configured environment must not fail credential-free mock jobs.
    expect(() =>
      assertProviderCredentials(mockSelection, runwayCredentials),
    ).not.toThrow();
  });
});
