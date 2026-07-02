import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen, revealMapOnMobile } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build tab shows the first-time hint once, never again after dismiss", async ({ page, isMobile }) => {
  await page.goto("/");
  await revealMapOnMobile(page, isMobile);
  const panel = page.getByTestId("front-panel");
  // On mobile the panel is in a bottom sheet; revealMapOnMobile enters Build
  // directly, while desktop still uses the Build tab.
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  if (!isMobile) {
    await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  }
  const hint = page.locator(".planner-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("לחצו על המפה");
  await hint.getByRole("button", { name: "הבנתי" }).click();
  await expect(hint).toBeHidden();
  // Persisted: a reload + Build tab shows no hint.
  await page.reload();
  await revealMapOnMobile(page, isMobile);
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  if (!isMobile) {
    await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  }
  await expect(page.locator(".planner-hint")).toBeHidden();
});

test("the tutorial modal and its nav item are gone from the planner", async ({ page, isMobile }) => {
  await page.goto("/");
  await revealMapOnMobile(page, isMobile);
  // On mobile the panel is in a bottom sheet — open it before asserting panel content.
  await ensurePanelOpen(page);
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "מדריך", exact: true })).toHaveCount(0);
  await expect(page.locator(".react-tutorial")).toHaveCount(0);
});
