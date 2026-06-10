import { test, expect } from "@playwright/test";

test("mobile: route cards show first; filters are behind a toggle", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only behavior");
  await page.goto("/routes/");
  const firstCard = page.locator(".route-card").first();
  await expect(firstCard).toBeVisible();
  // Filters collapsed by default; toggle visible instead.
  await expect(page.locator(".routes-page__search-panel")).toBeHidden();
  const toggle = page.getByRole("button", { name: /סינון/ });
  await expect(toggle).toBeVisible();
  // First card starts within the first viewport (no filter wall above it).
  const box = await firstCard.boundingBox();
  const viewport = page.viewportSize();
  expect(box.y).toBeLessThan(viewport.height);
  // Toggle opens the panel and filtering still works.
  await toggle.click();
  await expect(page.locator(".routes-page__search-panel")).toBeVisible();
  await page.getByRole("button", { name: "קל" }).click();
  await expect(page.locator(".routes-page__filter-actions")).toContainText("מסננים פעילים");
});

test("desktop: filter panel stays inline, no toggle", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop-only behavior");
  await page.goto("/routes/");
  await expect(page.locator(".routes-page__search-panel")).toBeVisible();
  await expect(page.locator(".routes-page__filters-toggle")).toBeHidden();
});
