import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("privacy policy page renders in Hebrew with contact address", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "מדיניות פרטיות" }),
  ).toBeVisible();
  await expect(page.getByText("ohad.serfaty@gmail.com").first()).toBeVisible();
  await expect(page.getByText("Mapbox").first()).toBeVisible();
});
