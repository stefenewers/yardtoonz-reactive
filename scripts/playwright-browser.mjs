export const playwrightBrowserSelections = {
  packageLocal: "sparticuz",
  standard: "playwright",
};

export function selectPlaywrightBrowser(platform) {
  return platform === "linux"
    ? playwrightBrowserSelections.packageLocal
    : playwrightBrowserSelections.standard;
}

async function getSparticuzChromium() {
  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";
  const { default: chromium } = await import("@sparticuz/chromium");
  chromium.setGraphicsMode = false;
  return chromium;
}

export async function getPlaywrightLaunchOptions(platform = process.platform) {
  if (
    selectPlaywrightBrowser(platform) === playwrightBrowserSelections.standard
  )
    return {};

  const chromium = await getSparticuzChromium();
  return {
    args: chromium.args,
    executablePath: await chromium.executablePath(),
  };
}

export async function getPlaywrightExecutablePath(platform = process.platform) {
  if (
    selectPlaywrightBrowser(platform) === playwrightBrowserSelections.standard
  ) {
    const { chromium } = await import("playwright");
    return chromium.executablePath();
  }

  return (await getSparticuzChromium()).executablePath();
}
