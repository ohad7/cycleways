import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("front panel shows discover by default and toggles to build", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  // Discover by default.
  await expect(panel.getByRole("tab", { name: "גילוי מסלול" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("מצאו את הרכיבה הבאה")).toBeVisible();
  // Toggle to build.
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await expect(panel.getByRole("tab", { name: "בניית מסלול" })).toHaveAttribute("aria-selected", "true");
});

test("collapse hides the panel and the reopen button restores it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "הסתר פאנל" }).click();
  await expect(page.getByTestId("front-panel")).toBeHidden();
  await page.getByRole("button", { name: "הצג פאנל" }).first().click();
  await expect(page.getByTestId("front-panel")).toBeVisible();
});
