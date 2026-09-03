import { describe, expect, it } from "vitest";

import { GET as conformanceGet } from "../../src/app/api/style/conformance/route";
import { GET as paletteGet } from "../../src/app/api/style/palette/route";
import { POST as promptPost } from "../../src/app/api/style/prompt/route";
import {
  enrichPromptsRequestSchema,
  styleGuideResponseSchema,
} from "../../src/domain/style-api";

function apiUrl(path: string): string {
  return `http://localhost/api/style/${path}`;
}

describe("GET /api/style/palette", () => {
  it("serves the full style guide over the committed brand assets", async () => {
    const response = await paletteGet();
    expect(response.status).toBe(200);

    const parsed = styleGuideResponseSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.logo.width).toBeGreaterThan(0);
    expect(parsed.data.logo.palette.length).toBeGreaterThanOrEqual(4);
    expect(parsed.data.logo.conformance.verdict).toBe("CONFORMANT");
    expect(parsed.data.tokenSet.version).toBe("clay-style-v1");
  });
});

describe("GET /api/style/conformance", () => {
  it("scores each committed fixture frame", async () => {
    const conformant = await conformanceGet(
      new Request(apiUrl("conformance?frame=conformant")),
    );
    expect(conformant.status).toBe(200);
    const conformantBody = (await conformant.json()) as {
      conformance: { verdict: string; score: number };
    };
    expect(conformantBody.conformance.verdict).toBe("CONFORMANT");

    const partial = await conformanceGet(
      new Request(apiUrl("conformance?frame=partial")),
    );
    const partialBody = (await partial.json()) as {
      conformance: { verdict: string };
    };
    expect(partialBody.conformance.verdict).toBe("PARTIAL");

    const offbrand = await conformanceGet(
      new Request(apiUrl("conformance?frame=offbrand")),
    );
    const offbrandBody = (await offbrand.json()) as {
      conformance: { verdict: string };
    };
    expect(offbrandBody.conformance.verdict).toBe("OFF_BRAND");
  });

  it("rejects unknown frame names with a 400", async () => {
    const response = await conformanceGet(
      new Request(apiUrl("conformance?frame=nonsense")),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_REQUEST");
  });
});

describe("POST /api/style/prompt", () => {
  it("enriches a treatment into a validated prompt pair", async () => {
    const response = await promptPost(
      new Request(apiUrl("prompt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          treatment: "A goat opens a dutch pot.",
          creativeDirection: "Steam rises.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      imagePrompt: string;
      motionPrompt?: string;
    };
    expect(body.imagePrompt).toContain("A goat opens a dutch pot.");
    expect(body.motionPrompt).toContain("Steam rises.");
  });

  it("rejects an invalid request body with a 400", async () => {
    const response = await promptPost(
      new Request(apiUrl("prompt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ treatment: "" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_REQUEST");
  });
});

describe("request schema parity", () => {
  it("shares the prompt request contract with the route", () => {
    expect(
      enrichPromptsRequestSchema.safeParse({ treatment: "x" }).success,
    ).toBe(true);
  });
});
