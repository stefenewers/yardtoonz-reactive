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

  await page.getByRole("button", { name: "Load demo candidates" }).click();
  await expect(page.getByText("10 candidates")).toBeVisible();

  await page
    .getByRole("button", {
      name: /One phone call turns a quiet reasoning into pure yard chaos/,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "One phone call turns a quiet reasoning into pure yard chaos.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Viral momentum")).toBeVisible();
  await expect(page.getByText("Humor response")).toBeVisible();
  await expect(page.getByText("Yard Toonz fit")).toBeVisible();

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
      mediaTools: [
        { name: "ffmpeg", available: true, diagnostic: "available" },
        { name: "ffprobe", available: true, diagnostic: "available" },
      ],
    },
  });

  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('"path"');
  expect(serialized).not.toContain('"error"');
  expect(serialized).not.toContain('"version"');
});
