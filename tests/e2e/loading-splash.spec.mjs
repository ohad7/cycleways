import { test, expect } from "@playwright/test";

test("splash paints with logo, title, and progress bar", async ({ page }) => {
  await page.goto("/", { waitUntil: "commit" });
  const splash = page.locator("#splash");
  await expect(splash).toBeVisible();
  // Brand logo image is present (reuses the favicon SVG data URI)
  await expect(splash.locator("img.splash__logo")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  // Hebrew site title is shown
  await expect(
    splash.getByText("מפת שבילי אופניים - גליל עליון וגולן"),
  ).toBeVisible();
  // Progress bar fill exists and the splash is at the default 15%
  const fill = splash.locator(".splash__bar-fill");
  await expect(fill).toBeVisible();
  const width = await splash.evaluate(
    (el) => getComputedStyle(el).getPropertyValue("--splash-progress").trim(),
  );
  expect(width).toBe("0.15");
});

test("window.__splash API advances the bar and removes the splash", async ({
  page,
}) => {
  // Isolate the controller from the React app: block the entry module so the
  // app cannot auto-dismiss the splash during this controller-level test.
  await page.route("**/src/main.jsx", (route) => route.abort());
  await page.goto("/", { waitUntil: "commit" });
  const splash = page.locator("#splash");
  await expect(splash).toBeVisible();

  // API exists (defined by the inline <head> script)
  await page.waitForFunction(
    () =>
      !!window.__splash &&
      typeof window.__splash.set === "function" &&
      typeof window.__splash.done === "function",
  );

  // set() advances the progress variable
  await page.evaluate(() => window.__splash.set(0.5));
  const mid = await splash
    .locator(".splash__bar-fill")
    .evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--splash-progress").trim(),
    );
  expect(mid).toBe("0.5");

  // done() hides then removes the node
  await page.evaluate(() => window.__splash.done());
  await expect(splash).toHaveCount(0);
});
