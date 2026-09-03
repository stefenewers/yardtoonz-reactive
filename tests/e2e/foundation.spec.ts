import { expect, test } from "@playwright/test";

test("foundation discloses mock providers and local tooling health", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "YardToonz Reactive" }),
  ).toBeVisible();
  await expect(page.getByText("Image provider")).toBeVisible();
  await expect(page.getByText("Animation provider")).toBeVisible();
  await expect(page.getByText("MOCK", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Available", { exact: true })).toHaveCount(2);
  await expect(
    page.getByText(/Human approval and rights confirmation/),
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
