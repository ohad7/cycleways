import { test, expect } from "@playwright/test";

test("no Google Analytics requests during tests", async ({ page }) => {
  const gaRequests = [];
  page.on("request", (req) => {
    if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/.test(req.url())) {
      gaRequests.push(req.url());
    }
  });
  await page.goto("/");
  await page.waitForTimeout(3000);
  expect(gaRequests).toEqual([]);
});
