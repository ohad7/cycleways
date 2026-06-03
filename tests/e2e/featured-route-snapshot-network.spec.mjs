import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

// Regression guard for the featured-route snapshot work: a public featured page
// must render entirely from public-data/featured-routes/<slug>.json and must NOT
// pull the heavy planner assets (CW network, segment metadata, CW base index, or
// base-routing shards). If this fails, the page has fallen back to the live
// decode path and the snapshot win is lost.

const HEAVY_ASSET_PATTERNS = [
  "bike_roads.geojson",
  "segments.json",
  "cw-base-index.json",
  "base-routing-shards/",
];

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("featured route renders from snapshot without planner assets", async ({ page }) => {
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));

  await page.goto("/featured/sovev-beit-hillel");

  // Page must actually render (so we know we're asserting on a loaded page, not
  // an error/empty shell that trivially makes no requests).
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
  await expect(page.locator(".fv-route-panel")).toBeVisible();
  await expect(page.locator(".fv-poi-stories")).toBeVisible();

  // The snapshot itself must have been fetched.
  expect(
    requestedUrls.some((url) =>
      url.includes("public-data/featured-routes/sovev-beit-hillel.json"),
    ),
    `expected the snapshot to be requested; saw:\n${requestedUrls.join("\n")}`,
  ).toBe(true);

  // None of the heavy planner assets may be requested.
  for (const pattern of HEAVY_ASSET_PATTERNS) {
    const offenders = requestedUrls.filter((url) => url.includes(pattern));
    expect(
      offenders,
      `featured page must not request "${pattern}", but saw:\n${offenders.join("\n")}`,
    ).toEqual([]);
  }
});
