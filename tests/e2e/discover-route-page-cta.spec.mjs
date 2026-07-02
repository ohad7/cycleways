import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

async function openFirstDiscoverRoutePage(page, isMobile = false) {
  await page.goto("/");
  const discoverScope = isMobile
    ? page.getByTestId("mobile-discover-home")
    : page.getByTestId("front-panel");
  if (!isMobile) await ensurePanelOpen(page);
  await expect(discoverScope).toBeVisible();
  const card = discoverScope.locator(".panel-route-card-wrap").first();
  await expect(card).toBeVisible();
  const href = await card.getAttribute("href");
  expect(href).toMatch(/^\/routes\/[a-z0-9-]+$/);
  const title = (await card.locator(".panel-route-card__title").innerText()).trim();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 20_000 });
  return { href, title };
}

test("Discover card opens the dedicated route page", async ({ page, isMobile }) => {
  const { title } = await openFirstDiscoverRoutePage(page, isMobile);
  await expect(page.locator(".featured-route-header h1")).toContainText(title);
  await expect(page.locator(".front-sheet")).toHaveCount(0);
});

test("route page exposes the planner CTA", async ({ page, isMobile }) => {
  await openFirstDiscoverRoutePage(page, isMobile);
  const plannerLink = page.locator('a[href*="?route="]').first();
  await expect(plannerLink).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await plannerLink.click();
  const plannerPage = await popupPromise;
  await plannerPage.waitForLoadState("domcontentloaded");
  await expect(plannerPage).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  if (isMobile) {
    await expect(plannerPage.locator(".front-sheet")).toHaveAttribute("data-snap", "half");
  } else {
    await ensurePanelOpen(plannerPage);
  }
  await expect(plannerPage.locator(".build-panel")).toBeVisible();
});
