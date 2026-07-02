import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

// Loads the first Discover card's route into the planner and returns the
// card's /routes/<slug> href and title. The whole card is a single link to the
// route page (`.panel-route-card-wrap` is the anchor; `.panel-route-card__story-link`
// is the decorative "לעמוד המסלול" label inside it), so the href lives on the wrap.
async function selectFirstDiscoverRoute(page, isMobile = false) {
  await page.goto("/");
  const discoverScope = isMobile
    ? page.getByTestId("mobile-discover-home")
    : page.getByTestId("front-panel");
  if (!isMobile) {
    await ensurePanelOpen(page);
    // Wait for the routing engine; a click before readiness falls back to a
    // full-page load by design.
    await expect(discoverScope).toHaveAttribute("data-route-status", "ready", {
      timeout: 30_000,
    });
  }
  await expect(discoverScope).toBeVisible();
  const card = discoverScope.locator(".panel-route-card-wrap").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".panel-route-card__story-link")).toBeVisible();
  const storyHref = await card.getAttribute("href");
  expect(storyHref).toBeTruthy();
  const title = (
    await card.locator(".panel-route-card__title").innerText()
  ).trim();
  await card.locator(".panel-route-card").click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  return { storyHref, title };
}

test("selecting a Discover card loads the route into Build", async ({ page, isMobile }) => {
  const { title } = await selectFirstDiscoverRoute(page, isMobile);
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel__title")).toContainText(title);
});

test("mobile: build peek shows the route name and a route-page link", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  const { storyHref, title } = await selectFirstDiscoverRoute(page, isMobile);
  // Do NOT call ensurePanelOpen here — the peek strip is only visible at
  // data-snap="peek"; opening the sheet would replace it with panel content.
  const sheet = page.locator(".front-sheet");
  // Route selection snaps the sheet back to peek.
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(
    sheet.locator(".front-sheet__build-peek span:first-child"),
  ).toContainText(title);
  const link = sheet.locator(".front-sheet__build-peek-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", storyHref);
});

test("editing the route (map click) resets the Build title", async ({ page, isMobile }) => {
  const { title } = await selectFirstDiscoverRoute(page, isMobile);
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel__title")).toContainText(title);
  // A map click always adds a route point — the loaded route diverges from the
  // catalog route, so the "recommended route" name gives way to the draft name.
  await page.evaluate(() => {
    window.__mockMapboxCurrentMap._emit("click", {
      lngLat: { lng: 35.6, lat: 33.05 },
      point: { x: 300, y: 200 },
    });
  });
  await expect(page.locator(".build-panel__title")).toHaveText("מסלול חדש");
});

test("clearing the route resets the Build title", async ({ page, isMobile }) => {
  const { title } = await selectFirstDiscoverRoute(page, isMobile);
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel__title")).toContainText(title);
  await page.getByTestId("front-panel").getByRole("button", { name: "נקה" }).click();
  await expect(page.locator(".build-panel__title")).toHaveText("מסלול חדש");
});
