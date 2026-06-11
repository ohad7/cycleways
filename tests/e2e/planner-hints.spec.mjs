import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build tab shows the first-time hint once, never again after dismiss", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  const hint = page.locator(".planner-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("לחצו על המפה");
  await hint.getByRole("button", { name: "הבנתי" }).click();
  await expect(hint).toBeHidden();
  // Persisted: a reload + Build tab shows no hint.
  await page.reload();
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await expect(page.locator(".planner-hint")).toBeHidden();
});

test("the tutorial modal and its nav item are gone from the planner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "מדריך", exact: true })).toHaveCount(0);
  await expect(page.locator(".react-tutorial")).toHaveCount(0);
});
