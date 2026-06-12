import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

// Loads the first Discover card's route into the planner and returns the
// card's /routes/<slug> href and title for comparison with the Build CTA.
async function selectFirstDiscoverRoute(page) {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  // Wait for the routing engine; a click before readiness falls back to a
  // full-page load by design.
  await expect(panel).toHaveAttribute("data-route-status", "ready", {
    timeout: 30_000,
  });
  const card = panel.locator(".panel-route-card-wrap").first();
  await expect(card).toBeVisible();
  const storyHref = await card
    .locator(".panel-route-card__story-link")
    .getAttribute("href");
  const title = (
    await card.locator(".panel-route-card__title").innerText()
  ).trim();
  await card.locator(".panel-route-card").click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  return { storyHref, title };
}

test("selecting a Discover card shows the route-page CTA in Build", async ({ page }) => {
  const { storyHref, title } = await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  const cta = page.locator(".build-panel__story-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", storyHref);
  await expect(page.locator(".build-panel__title")).toContainText(title);
});

test("mobile: build peek shows the route name and a route-page link", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  const { storyHref, title } = await selectFirstDiscoverRoute(page);
  const sheet = page.locator(".front-sheet");
  // Route selection snaps the sheet back to peek.
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(
    sheet.locator(".front-sheet__build-peek span").first(),
  ).toContainText(title);
  const link = sheet.locator(".front-sheet__build-peek-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", storyHref);
});

test("editing the route (map click) hides the CTA", async ({ page }) => {
  await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel__story-cta")).toBeVisible();
  // A map click always adds a route point — the loaded route diverges from
  // the catalog route, so the CTA must disappear.
  await page.evaluate(() => {
    window.__mockMapboxCurrentMap._emit("click", {
      lngLat: { lng: 35.6, lat: 33.05 },
      point: { x: 300, y: 200 },
    });
  });
  await expect(page.locator(".build-panel__story-cta")).toHaveCount(0);
  await expect(page.locator(".build-panel__title")).toHaveText("מסלול חדש");
});

test("clearing the route hides the CTA", async ({ page }) => {
  await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  const panel = page.getByTestId("front-panel");
  await expect(page.locator(".build-panel__story-cta")).toBeVisible();
  await panel.getByRole("button", { name: "נקה" }).click();
  await expect(page.locator(".build-panel__story-cta")).toHaveCount(0);
});

test("the Build CTA navigates to the route page", async ({ page }) => {
  const { storyHref } = await selectFirstDiscoverRoute(page);
  await ensurePanelOpen(page);
  await page.locator(".build-panel__story-cta").click();
  await expect(page).toHaveURL(new RegExp(`${storyHref}$`));
});
