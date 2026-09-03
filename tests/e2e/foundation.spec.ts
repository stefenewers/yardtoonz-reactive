import { expect, test } from "@playwright/test";

test("candidate moves from inbox through approval and rights gate to upload", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Candidate inbox" }),
  ).toBeVisible();
  await expect(page.getByText("Image provider")).toBeVisible();
  await expect(page.getByText("Animation provider")).toBeVisible();
  await expect(page.getByText("MOCK", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Mock mode")).toBeVisible();
  await expect(page.getByText("Image · Mock")).toBeVisible();
  await expect(page.getByText("Animation · Mock")).toBeVisible();
  await expect(page.getByText("System ready")).toBeVisible();

  await page.getByRole("button", { name: "Load demo candidates" }).click();
  await expect(page.getByText("10 candidates")).toBeVisible();

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: /Viral momentum/ }),
  ).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: /Yard Toonz fit/ }),
  ).toBeVisible();
  await expect(
    page
      .locator(".list-toolbar")
      .getByText(/Overall = 40% viral momentum \+ 30% humor response/),
  ).toBeVisible();

  const humorHeader = table.getByRole("columnheader", {
    name: /Humor response/,
  });
  await humorHeader.getByRole("button").click();
  await expect(humorHeader).toHaveAttribute("aria-sort", "descending");
  await humorHeader.getByRole("button").click();
  await expect(humorHeader).toHaveAttribute("aria-sort", "ascending");

  await page
    .getByRole("button", {
      name: /The bus finally arrives just as everybody gives up waiting/,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "The bus finally arrives just as everybody gives up waiting.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Viral momentum", { exact: true })).toBeVisible();
  await expect(page.getByText("Humor response", { exact: true })).toBeVisible();
  await expect(page.getByText("Yard Toonz fit", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve for production" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm source rights" }),
  ).toBeVisible();

  const continueButton = page.getByRole("button", {
    name: "Confirm rights and continue",
  });
  await expect(continueButton).toBeDisabled();
  await expect(
    page.getByText("Confirm authorization to continue to clip upload."),
  ).toBeVisible();

  await page
    .getByRole("checkbox", {
      name: /I confirm Yard Toonz is authorized/,
    })
    .check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(
    page.getByRole("heading", { name: "Upload the source clip" }),
  ).toBeVisible();
  await expect(page.getByText("Rights confirmed")).toBeVisible();
  await expect(
    page.getByText("Choose an authorized MP4", { exact: true }),
  ).toBeVisible();
});

test("health endpoint exposes only safe provider and tool diagnostics", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);

  const body: unknown = await response.json();
  expect(body).toMatchObject({
    status: "ok",
    providers: { image: "MOCK", animation: "MOCK" },
    checks: {
      database: { diagnostic: "available" },
      artifactRoot: { diagnostic: "writable" },
      mediaTools: [
        { name: "ffmpeg", available: true, diagnostic: "available" },
        { name: "ffprobe", available: true, diagnostic: "available" },
      ],
    },
  });

  // The worker may be fresh, stale, or unknown depending on local state; the
  // public contract is that the value stays inside the bounded categories.
  const workerDiagnostic = (
    body as { checks: { worker: { diagnostic: string } } }
  ).checks.worker.diagnostic;
  expect(["fresh", "stale", "unknown"]).toContain(workerDiagnostic);

  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('"path"');
  expect(serialized).not.toContain('"error"');
  expect(serialized).not.toContain('"version"');
  expect(serialized).not.toContain('"observedAt"');
});
