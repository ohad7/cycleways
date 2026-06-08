import { expect, test } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("mobile adapted layout remains usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only regression check");

  await page.goto("/?route=Bjjy1nRHHDArrNAoctqGv4RHL3un");

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#route-description")).toContainText("4.5 ק\"מ");
  await expect(page.locator("#download-gpx")).toBeEnabled();

  const widthMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(widthMetrics.scrollWidth).toBeLessThanOrEqual(widthMetrics.clientWidth);
  expect(widthMetrics.bodyScrollWidth).toBeLessThanOrEqual(
    widthMetrics.bodyClientWidth,
  );

  await page.locator(".mobile-menu-btn").click();
  await expect(page.locator("#nav-links")).toBeVisible();
  await expect(page.locator("#nav-links")).toContainText("מסלולים");
  await page.locator(".mobile-menu-btn").click();
  await expect(page.locator("#nav-links")).not.toHaveClass(/active/);

  await page.locator("#download-gpx").click();
  await expect(page.getByRole("dialog", { name: "הורדת מסלול GPX" })).toBeVisible();
  const modalBounds = await page.locator(".download-modal-content").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      viewportWidth: window.innerWidth,
    };
  });
  expect(modalBounds.left).toBeGreaterThanOrEqual(0);
  expect(modalBounds.right).toBeLessThanOrEqual(modalBounds.viewportWidth);
  expect(modalBounds.width).toBeGreaterThan(250);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.locator("#contact").scrollIntoViewIfNeeded();
  await expect(page.getByText("רכיבה מהנה ובטוחה!")).toBeVisible();
});
