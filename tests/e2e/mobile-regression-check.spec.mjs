import { expect, test } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("mobile adapted layout remains usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only regression check");

  await page.goto("/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un");

  await expect(page.locator("#map")).toBeVisible();
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel")).toContainText("4.5");
  // Save/summary now lives in the route panel (Build state, auto-entered for ?route=).
  await expect(page.getByRole("button", { name: "GPX" })).toBeEnabled();

  const widthMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(widthMetrics.scrollWidth).toBeLessThanOrEqual(widthMetrics.clientWidth);
  expect(widthMetrics.bodyScrollWidth).toBeLessThanOrEqual(
    widthMetrics.bodyClientWidth,
  );

  await page.locator(".mobile-menu-btn").click();
  await expect(page.locator("#nav-links")).toBeVisible();
  await expect(page.locator("#nav-links")).toContainText("מסלולים");
  await page.locator(".mobile-menu-btn").click();
  await expect(page.locator("#nav-links")).not.toHaveClass(/active/);

  // GPX button is a direct download (no modal) in the new panel.
  await expect(page.getByRole("button", { name: "GPX" })).toBeEnabled();

  await expect(page.locator(".front-shell")).toBeVisible();
  await expect(page.locator(".front-sheet")).toBeVisible();
});
