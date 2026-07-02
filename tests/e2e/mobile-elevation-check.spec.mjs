import { expect, test } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

// A pre-encoded route in the network that has an elevation profile.
const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

// Guards the recent elevation-profile features (slope-grade coloring, legend,
// grade chip) on a phone viewport: the legend must render and fit within the
// route-description panel without forcing horizontal page overflow.
test("mobile: elevation slope legend renders within the panel", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout check");

  await page.goto(`/?route=${COMPACT_ROUTE}`);

  // Wait for the restored route. Mobile route-param loads now open the sheet
  // directly to half so stats/elevation are immediately visible.
  await page.waitForSelector(".map-container--route-ready", { timeout: 30000 });
  await expect(page.locator(".front-sheet")).toHaveAttribute("data-snap", "half");

  await ensurePanelOpen(page);
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.getByTestId("front-panel").getByText('4.5 ק"מ').first()).toBeVisible();

  const legend = page.locator(".react-elevation-legend");
  await expect(legend).toBeVisible();

  // The legend lists the slope-grade classes.
  await expect(legend).toContainText("קל");
  await expect(legend).toContainText("קשוח");

  // No horizontal page overflow on a phone viewport.
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);

  // The legend stays within the viewport horizontally.
  const box = await legend.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(widths.clientWidth);
});

test("mobile: elevation progress head remains visible during route playback", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout check");

  await page.goto(`/?route=${COMPACT_ROUTE}`);
  await page.waitForSelector(".map-container--route-ready", { timeout: 30000 });
  await expect(page.locator(".front-sheet")).toHaveAttribute("data-snap", "half");
  await ensurePanelOpen(page);

  const mapPlayback = page.locator(".planner-route-playback--map");
  await expect(mapPlayback).toBeVisible();
  await expect(page.locator(".planner-route-playback--panel")).toHaveCount(0);
  await mapPlayback.getByRole("button", { name: "נגן מסלול על המפה" }).click();
  await expect(page.locator(".front-sheet")).toHaveAttribute("data-snap", "half");

  const marker = page.locator(".panel-elev .elevation-progress-head-pulse");
  const cursorInfo = page.locator(".panel-elev .react-elevation-hover-info");
  await expect(marker).toBeVisible();
  await expect(marker).toHaveClass(/elevation-progress-head-pulse--playing/);
  await expect(cursorInfo).toBeVisible();
  await expect(cursorInfo).toContainText("מרחק:");
  await expect(cursorInfo).toContainText("גובה:");
  await expect(cursorInfo.locator(".react-grade-chip")).toBeVisible();

  await mapPlayback.getByRole("button", { name: "השהה מסלול על המפה" }).click();
  await expect(cursorInfo).toBeVisible();
  await mapPlayback.locator(".fv-video-scrubber").evaluate((input) => {
    input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    input.value = String(Number(input.max) / 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(marker).toBeVisible();
  await expect(cursorInfo).toBeVisible();
});
