import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("selecting a Discover route opens its route page", async ({ page, isMobile }) => {
  await page.goto("/");
  const discoverScope = isMobile
    ? page.getByTestId("mobile-discover-home")
    : page.getByTestId("front-panel");
  if (!isMobile) {
    await ensurePanelOpen(page);
    await expect(discoverScope).toHaveAttribute("data-route-status", "ready", {
      timeout: 30_000,
    });
  }
  await expect(discoverScope).toBeVisible();
  // A full navigation would lose this flag.
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  const card = discoverScope.locator(".panel-route-card-wrap").first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", /\/routes\/[a-z0-9-]+/);
  await card.click();
  await expect(page).toHaveURL(/\/routes\/[a-z0-9-]+$/, { timeout: 20_000 });
  await expect(page.locator(".front-sheet")).toHaveCount(0);
  expect(await page.evaluate(() => window.__sameDocument)).not.toBe(true);
});
