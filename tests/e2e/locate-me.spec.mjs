import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

// A fix at Shde Nehemia (inside the Upper-Galilee map area).
// Using Shde Nehemia rather than Beit Hillel itself so that sovev-beit-hillel
// (which has both beit-hillel and shdeh-nehemia as start places) gets distance 0m
// while banias-gan-hatsafon (which starts at hagoshrim/beit-hillel) gets ~1346m —
// making sovev-beit-hillel unambiguously first after the near-me sort.
test.use({
  geolocation: { latitude: 33.2056, longitude: 35.6101 },
  permissions: ["geolocation"],
});

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("locate button surfaces near-me labels and sort in Discover", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  const locate = page.getByRole("button", { name: "מצא את המיקום שלי" });
  await expect(locate).toBeVisible();
  await locate.click();
  // Distance labels appear on the cards.
  await expect(panel.locator(".panel-route-card__near").first()).toContainText("ממך");
  // The near-me sort chip appears and re-orders by distance: the fix sits in
  // Beit Hillel, so sovev-beit-hillel must come first.
  await panel.getByRole("button", { name: "קרוב אליי" }).click();
  await expect(panel.locator(".panel-route-card").first()).toContainText("סובב בית הלל");
});

test("denied geolocation degrades to an error message", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await page.getByRole("button", { name: "מצא את המיקום שלי" }).click();
  // The geolocation error path may take up to ~10s in some configurations.
  await expect(page.locator("#search-error")).toContainText("לא הצלחנו לאתר את המיקום שלך", { timeout: 15000 });
});
