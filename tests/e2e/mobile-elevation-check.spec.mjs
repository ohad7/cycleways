import { expect, test } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

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

  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.getByText('4.5 ק"מ').first()).toBeVisible();

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
