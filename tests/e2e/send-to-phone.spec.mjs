import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build panel offers a QR that encodes the share URL", async ({ page }) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  await ensurePanelOpen(page);
  await panel.getByRole("button", { name: "שלחו לטלפון" }).click();
  const modal = page.locator(".send-to-phone");
  await expect(modal).toBeVisible();
  // The QR is rendered as an SVG (qrcode-generator's createSvgTag output).
  await expect(modal.locator("svg, img")).toHaveCount(1);
  await expect(modal).toContainText("סרקו עם הטלפון");
  await modal.getByRole("button", { name: "סגירה" }).click();
  await expect(modal).toBeHidden();
});
