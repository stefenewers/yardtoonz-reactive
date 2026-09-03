import { expect, test } from "@playwright/test";

test("foundation discloses mock mode and local tooling health", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "YardToonz Reactive" }),
  ).toBeVisible();
  await expect(page.getByText("MOCK", { exact: true })).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toHaveCount(2);
  await expect(
    page.getByText(/Human approval and rights confirmation/),
  ).toBeVisible();
});

test("health endpoint reports bundled media tools", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    providerMode: "MOCK",
    checks: {
      mediaTools: [
        { name: "ffmpeg", available: true },
        { name: "ffprobe", available: true },
      ],
    },
  });
});
