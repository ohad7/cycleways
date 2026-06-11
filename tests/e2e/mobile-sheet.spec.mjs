import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("mobile: peek shows the two-action story; find-route opens Discover", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(sheet.getByRole("button", { name: "מצאו מסלול מוכן" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "בנו מסלול" })).toBeVisible();
  // Panel content is hidden at peek.
  await expect(sheet.locator(".panel-route-card").first()).toBeHidden();
  await sheet.getByRole("button", { name: "מצאו מסלול מוכן" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(sheet.locator(".panel-route-card").first()).toBeVisible();
});

test("mobile: selecting a route drops the sheet back to peek", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  const sheet = page.locator(".front-sheet");
  await sheet.getByRole("button", { name: "מצאו מסלול מוכן" }).click();
  await sheet.locator(".panel-route-card").first().click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await expect(sheet).toHaveAttribute("data-snap", "peek");
});

test("mobile: בנו מסלול switches to Build and keeps the map front", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const sheet = page.locator(".front-sheet");
  await sheet.getByRole("button", { name: "בנו מסלול" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
  await expect(
    page.getByTestId("front-panel").getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("desktop: no sheet affordances, side panel as before", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop-only");
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.locator(".front-sheet__grip")).toBeHidden();
  await expect(page.locator(".front-sheet__peek")).toBeHidden();
});
