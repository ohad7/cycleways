import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("front panel shows discover by default and toggles to build", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    const home = page.getByTestId("mobile-discover-home");
    await expect(home).toBeVisible();
    await expect(home.getByText("גליל עליון על אופניים")).toBeVisible();
    await expect(home.getByText("לאן רוכבים היום?")).toBeVisible();
    await expect(home.locator(".panel-route-hero")).toBeVisible();
    await expect(home.locator(".panel-route-card").first()).toBeVisible();
    await expect(page.locator(".front-sheet")).toHaveCount(0);
    await expect(page.locator(".map-container")).toHaveCount(0);

    await home.getByRole("button", { name: "+ תכנן מסלול" }).click();
    const panel = page.getByTestId("front-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "בניית מסלול" })).toHaveAttribute("aria-selected", "true");
    return;
  }

  const panel = page.getByTestId("front-panel");
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  // Discover by default.
  await expect(panel.getByRole("tab", { name: "חפש מסלול" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("לאן רוכבים היום?")).toBeVisible();
  await expect(panel.locator(".panel-route-hero")).toBeVisible();
  await expect(panel.locator(".panel-route-hero__summary")).toBeVisible();
  await expect(panel.locator(".panel-route-card").first()).toBeVisible();
  await expect(panel.locator(".panel-route-card__summary").first()).toBeVisible();
  const heroTitle = (await panel.locator(".panel-route-hero__title").innerText()).trim();
  const secondaryTitles = await panel.locator(".panel-route-card__title").allInnerTexts();
  expect(secondaryTitles.map((title) => title.trim())).not.toContain(heroTitle);
  // Toggle to build.
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await expect(panel.getByRole("tab", { name: "בניית מסלול" })).toHaveAttribute("aria-selected", "true");
});

test("collapse hides the panel and the reopen button restores it", async ({ page, isMobile }) => {
  test.skip(isMobile, "collapse is desktop-only; mobile uses the sheet");
  await page.goto("/");
  await page.getByRole("button", { name: "הסתר פאנל" }).click();
  await expect(page.getByTestId("front-panel")).toBeHidden();

  await page.waitForTimeout(350);
  const collapsedBounds = await page.locator(".front-shell").evaluate((shell) => {
    const shellBox = shell.getBoundingClientRect();
    const mapBox = shell.querySelector(".map-container").getBoundingClientRect();
    return {
      shell: {
        x: shellBox.x,
        right: shellBox.right,
        width: shellBox.width,
      },
      map: {
        x: mapBox.x,
        right: mapBox.right,
        width: mapBox.width,
      },
    };
  });
  expect(collapsedBounds.map.width).toBeGreaterThan(collapsedBounds.shell.width - 20);
  expect(collapsedBounds.map.x).toBeLessThanOrEqual(collapsedBounds.shell.x + 8);
  expect(collapsedBounds.map.right).toBeGreaterThanOrEqual(collapsedBounds.shell.right - 8);

  await page.getByRole("button", { name: "הצג פאנל" }).first().click();
  await expect(page.getByTestId("front-panel")).toBeVisible();
});
