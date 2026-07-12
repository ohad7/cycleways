import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build panel offers a QR that encodes the share URL", async ({ page, isMobile }) => {
  test.skip(isMobile, "send-to-phone is a desktop Build-panel action");
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  await ensurePanelOpen(page);
  const opener = panel.getByRole("button", { name: "שלחו לטלפון" });
  await opener.click();
  const modal = page.locator(".send-to-phone");
  await expect(modal).toBeVisible();
  // The QR is rendered as an SVG (qrcode-generator's createSvgTag output).
  await expect(modal.locator("svg, img")).toHaveCount(1);
  await expect(modal).toContainText("סרקו עם הטלפון");
  const close = modal.getByRole("button", { name: "סגירה" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(opener).toBeFocused();
});
