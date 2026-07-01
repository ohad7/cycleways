import { test, expect } from "@playwright/test";

test("featured route shell renders header for known slug", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
  await expect(
    page.locator(".fv-route-actions").getByRole("button", { name: "נגן מסלול" }),
  ).toBeVisible();
});

test("featured route page returns 404-style message for unknown slug", async ({ page }) => {
  await page.goto("/featured/zzz-not-real");
  await expect(page.locator(".featured-route-404")).toBeVisible();
});

test("app embed omits web chrome and reports route readiness", async ({ page }) => {
  await page.addInitScript(() => {
    window.__nativeMessages = [];
    window.ReactNativeWebView = {
      postMessage(payload) {
        window.__nativeMessages.push(JSON.parse(payload));
      },
    };
  });

  await page.goto("/routes/sovev-beit-hillel?app=1");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
  await expect(page.locator("header.header")).toHaveCount(0);
  await expect(page.locator(".featured-route-header .breadcrumbs")).toHaveCount(0);
  const actions = page.locator(".fv-route-actions .fv-route-action");
  await expect(actions).toHaveCount(3);
  await expect(page.locator(".fv-route-actions")).not.toContainText("נגן מסלול");
  await expect(page.locator(".fv-route-actions")).toContainText("נווט");
  await expect(page.locator(".fv-route-actions")).toContainText("עריכה");
  await expect(page.locator(".fv-route-actions")).toContainText("GPX");
  await expect(
    page.locator(".fv-route-actions .fv-route-action--primary"),
  ).toHaveCSS("background-color", "rgb(47, 107, 60)");
  await expect(actions.nth(1)).toHaveCSS("background-color", "rgb(248, 251, 250)");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__nativeMessages.some(
          (message) =>
            message.type === "ready" && message.slug === "sovev-beit-hillel",
        ),
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "נווט במסלול" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__nativeMessages.some(
          (message) =>
            message.type === "navigate" &&
            message.slug === "sovev-beit-hillel" &&
            typeof message.route === "string" &&
            message.route.length > 0,
        ),
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Download GPX - הורד קובץ ניווט" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__nativeMessages.some(
          (message) =>
            message.type === "download" &&
            message.slug === "sovev-beit-hillel" &&
            message.filename === "sovev-beit-hillel.gpx",
        ),
      ),
    )
    .toBe(true);
});
