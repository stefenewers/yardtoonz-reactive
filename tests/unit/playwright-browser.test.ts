import { describe, expect, it } from "vitest";

import {
  getPlaywrightLaunchOptions,
  selectPlaywrightBrowser,
} from "../../scripts/playwright-browser.mjs";

describe("Playwright browser selection", () => {
  it("selects package-local Sparticuz Chromium on Linux", () => {
    expect(selectPlaywrightBrowser("linux")).toBe("sparticuz");
  });

  it.each(["darwin", "win32"] as const)(
    "selects standard Playwright Chromium on %s",
    (platform) => {
      expect(selectPlaywrightBrowser(platform)).toBe("playwright");
    },
  );

  it("does not resolve or launch a browser for non-Linux selection tests", async () => {
    await expect(getPlaywrightLaunchOptions("darwin")).resolves.toEqual({});
  });
});
