export type PlaywrightBrowserSelection = "sparticuz" | "playwright";

export const playwrightBrowserSelections: {
  readonly packageLocal: "sparticuz";
  readonly standard: "playwright";
};

export function selectPlaywrightBrowser(
  platform: NodeJS.Platform,
): PlaywrightBrowserSelection;

export function getPlaywrightLaunchOptions(
  platform?: NodeJS.Platform,
): Promise<{ args?: string[]; executablePath?: string }>;

export function getPlaywrightExecutablePath(
  platform?: NodeJS.Platform,
): Promise<string>;
