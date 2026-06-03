import { test, expect } from "@playwright/test";

test("splash paints with logo, title, and progress bar", async ({ page }) => {
  // Block external scripts so milestones don't fire and advance the bar
  // before we can observe the initial 15% default. RegExp matchers are used
  // (not globs) because Vite serves the entry with a cache-busting query, e.g.
  // /src/main.jsx?t=1780446804536, which a trailing-anchored glob would miss.
  await page.route(/mapbox-gl\.js/, (route) => route.abort());
  await page.route(/\/src\/main\.jsx/, (route) => route.abort());
  await page.goto("/", { waitUntil: "commit" });
  const splash = page.locator("#splash");
  await expect(splash).toBeVisible();
  // Brand logo image is present (inlined optimized PNG data URI)
  await expect(splash.locator("img.splash__logo")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
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
  // RegExp (not glob) so Vite's cache-busting ?t= query is still matched.
  await page.route(/\/src\/main\.jsx/, (route) => route.abort());
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

test("splash is removed once the app is ready", async ({ page }) => {
  await page.goto("/");
  // App has rendered its header
  await expect(
    page.getByRole("heading", {
      name: "מפת שבילי אופניים - גליל עליון וגולן",
      exact: true,
    }),
  ).toBeVisible();
  // Splash has been removed (not just hidden)
  await expect(page.locator("#splash")).toHaveCount(0);
});
