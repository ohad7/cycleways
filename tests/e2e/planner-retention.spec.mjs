import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

async function loadFirstDiscoverRoute(page, isMobile) {
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await expect(page.locator(".map-container--route-ready")).toBeVisible({ timeout: 30_000 });
  // Let the 800ms autosave debounce flush.
  await page.waitForTimeout(1200);
}

test("draft restore banner revives the last route after a reload", async ({ page, isMobile }) => {
  // The draft-restore banner is a desktop affordance: it lives in the map shell,
  // which mobile doesn't show on its discover-home landing.
  test.skip(isMobile, "draft-restore banner is desktop-only; mobile lands on discover-home");
  await loadFirstDiscoverRoute(page, isMobile);
  await page.goto("/"); // no ?route= → restore offer
  const banner = page.locator(".draft-restore-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.getByRole("button", { name: "שחזור" }).click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  // On mobile the sheet snaps to peek after route restore — open it to assert panel state.
  await ensurePanelOpen(page);
  await expect(
    page.getByTestId("front-panel").getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("loaded routes are retained but the recents strip is hidden", async ({ page, isMobile }) => {
  await loadFirstDiscoverRoute(page, isMobile);
  await page.goto("/");
  // After a reload with no ?route=, desktop shows the front panel and mobile
  // shows the discover-home landing. Neither surfaces the recents strip.
  const scope = isMobile
    ? page.getByTestId("mobile-discover-home")
    : page.getByTestId("front-panel");
  if (!isMobile) await ensurePanelOpen(page);
  await expect(scope).toBeVisible();
  const strip = scope.locator(".recent-routes");
  await expect(strip).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("cycleways:planner-draft") || ""),
  ).not.toBe("");
});
