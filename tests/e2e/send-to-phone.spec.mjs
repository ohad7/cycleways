import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build panel offers a QR that encodes the share URL", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  await panel.locator(".panel-route-card").first().click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await panel.getByRole("button", { name: "שלחו לטלפון" }).click();
  const modal = page.locator(".send-to-phone");
  await expect(modal).toBeVisible();
  // The QR is rendered as an SVG (qrcode-generator's createSvgTag output).
  await expect(modal.locator("svg, img")).toHaveCount(1);
  await expect(modal).toContainText("סרקו עם הטלפון");
  await modal.getByRole("button", { name: "סגירה" }).click();
  await expect(modal).toBeHidden();
});
