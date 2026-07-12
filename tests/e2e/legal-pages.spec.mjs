import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { SUPPORT_EMAIL } from "../../packages/core/src/config/appLinks.js";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("privacy policy page renders in Hebrew with contact address", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "מדיניות פרטיות" }),
  ).toBeVisible();
  await expect(page.getByText(SUPPORT_EMAIL).first()).toBeVisible();
  await expect(page.getByText("Mapbox").first()).toBeVisible();
  await expect(page.getByText(/Google Analytics 4/).first()).toBeVisible();
  await expect(page.getByText(/מחרוזת שאילתה/).first()).toBeVisible();
  await expect(page.getByText(/Google Forms/).first()).toBeVisible();
  await expect(page.getByText(/אין באתר ובאפליקציה חשבונות משתמש/)).toHaveCount(0);
});

test("accessibility page documents the exemption, alternatives and limitations", async ({ page }) => {
  await page.goto("/accessibility");
  await expect(
    page.getByRole("heading", { level: 1, name: "נגישות באתר CycleWays" }),
  ).toBeVisible();
  await expect(page.getByText(/35ו\(ז\)/).first()).toBeVisible();
  await expect(page.getByText(/מגבלות ידועות/).first()).toBeVisible();
  await expect(page.getByText(SUPPORT_EMAIL).first()).toBeVisible();
  await expect(page.getByText(/fully accessible/i)).toHaveCount(0);
});

test("terms of use page renders with safety language", async ({ page }) => {
  await page.goto("/terms");
  await expect(
    page.getByRole("heading", { level: 1, name: "תנאי שימוש" }),
  ).toBeVisible();
  await expect(page.getByText("בטיחות ואחריות").first()).toBeVisible();
});

test("support page renders with contact channels and credits", async ({ page }) => {
  await page.goto("/support");
  await expect(
    page.getByRole("heading", { level: 1, name: "תמיכה ויצירת קשר" }),
  ).toBeVisible();
  await expect(page.getByText(SUPPORT_EMAIL).first()).toBeVisible();
  await expect(page.getByText("OpenStreetMap").first()).toBeVisible();
});

test("home page footer links to the legal pages", async ({ page, isMobile }) => {
  // The mobile home layout is the full-screen discover list without the
  // content sections + footer, so this check is desktop-only.
  test.skip(isMobile, "footer only renders on the desktop home page");
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "מדיניות פרטיות" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "תנאי שימוש" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "נגישות" })).toHaveAttribute("href", "/accessibility");
  await expect(footer.getByRole("link", { name: "תמיכה" })).toHaveAttribute("href", "/support");
});
