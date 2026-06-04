import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("default layout: rail map, no elevation graph", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".fv-route-panel")).toBeVisible();
    await expect(page.locator(".fv-side-map")).toBeVisible();
    await expect(page.locator(".fv-playback--overlay")).toHaveCount(0);
    await expect(page.locator(".elevation-profile")).toHaveCount(0);
  });

  test("overlay layout: PiP map on video + elevation graph, no rail map", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel?layout=overlay");
    await expect(page.locator(".fv-playback--overlay")).toBeVisible();
    // PiP map lives inside the video shell.
    await expect(page.locator(".fv-video-shell .fv-mobile-map")).toBeVisible();
    // Rail shows the elevation graph and the stats block, not the rail map.
    await expect(page.locator(".elevation-profile")).toBeVisible();
    await expect(page.locator(".fv-route-stats")).toBeVisible();
    await expect(page.locator(".fv-side-map")).toHaveCount(0);
  });

  test("overlay still renders from snapshot without planner assets", async ({ page }) => {
    const urls = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/featured/sovev-beit-hillel?layout=overlay");
    await expect(page.locator(".elevation-profile")).toBeVisible();
    for (const pattern of ["bike_roads.geojson", "segments.json", "cw-base-index.json", "base-routing-shards/"]) {
      expect(urls.filter((u) => u.includes(pattern)), pattern).toEqual([]);
    }
  });

  test("hovering the elevation graph moves the video cursor on the map", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel?layout=overlay");
    const overlay = page.locator(".elevation-hover-overlay");
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    // The hover sets a video cursor; the elevation marker line becomes visible.
    await expect(page.locator(".elevation-profile svg line")).toHaveAttribute("opacity", "1");
  });
});
