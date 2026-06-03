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
