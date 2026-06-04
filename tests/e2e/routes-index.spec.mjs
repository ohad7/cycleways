import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("/routes lists every recommended catalog route", async ({ page }) => {
  await page.goto("/routes");
  await expect(page.locator(".routes-page")).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "סובב בית הלל" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "בניאס" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "הירדן ההיסטורי" })).toBeVisible();
});

test("/routes card opens planner and detail actions", async ({ page }) => {
  await page.goto("/routes");
  const historic = page.locator(".route-card", { hasText: "הירדן ההיסטורי" });
  await expect(historic.getByRole("link", { name: "פתח במפה" })).toHaveAttribute("href", /route=/);
  await historic.getByRole("link", { name: "פרטים" }).click();
  await expect(page).toHaveURL(/\/routes\/historic-jordan$/);
  await expect(page.locator(".route-detail h1")).toContainText("הירדן ההיסטורי");
});

test("/routes rich story route keeps story shell", async ({ page }) => {
  await page.goto("/routes/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});
