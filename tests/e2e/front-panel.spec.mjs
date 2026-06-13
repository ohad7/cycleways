import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("front panel shows discover by default and toggles to build", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  // On mobile the panel is in a bottom sheet — open it before interacting.
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  // Discover by default.
  await expect(panel.getByRole("tab", { name: "חפש מסלול" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("מצאו את הרכיבה הבאה")).toBeVisible();
  // Toggle to build.
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await expect(panel.getByRole("tab", { name: "בניית מסלול" })).toHaveAttribute("aria-selected", "true");
});

test("collapse hides the panel and the reopen button restores it", async ({ page, isMobile }) => {
  test.skip(isMobile, "collapse is desktop-only; mobile uses the sheet");
  await page.goto("/");
  await page.getByRole("button", { name: "הסתר פאנל" }).click();
  await expect(page.getByTestId("front-panel")).toBeHidden();
  await page.getByRole("button", { name: "הצג פאנל" }).first().click();
  await expect(page.getByTestId("front-panel")).toBeVisible();
});
