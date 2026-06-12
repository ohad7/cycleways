import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

async function loadFirstDiscoverRoute(page) {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  // On mobile the panel is in a bottom sheet — open it before interacting.
  await ensurePanelOpen(page);
  const card = panel.locator(".panel-route-card").first();
  const name = (await card.locator(".panel-route-card__title").textContent()).trim();
  await card.click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  // Let the 800ms autosave debounce flush.
  await page.waitForTimeout(1200);
  return name;
}

test("draft restore banner revives the last route after a reload", async ({ page }) => {
  await loadFirstDiscoverRoute(page);
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

test("dismissing the draft banner deletes it", async ({ page }) => {
  await loadFirstDiscoverRoute(page);
  await page.goto("/");
  const banner = page.locator(".draft-restore-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.getByRole("button", { name: "סגירה" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("cycleways:planner-draft") || ""),
  ).toBe("");
  await page.goto("/");
  await expect(banner).toBeHidden();
});

test("a loaded route appears in the recents strip", async ({ page }) => {
  const name = await loadFirstDiscoverRoute(page);
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  // On mobile the panel is in a bottom sheet — open it before interacting.
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  const strip = panel.locator(".recent-routes");
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(strip).toContainText("המסלולים שלי");
  await expect(strip.locator(".recent-routes__item").first()).toContainText(
    name.replace(/\s+/g, " ").trim().split(" ").slice(-2).join(" "),
  );
});
