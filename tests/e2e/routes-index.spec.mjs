import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

function clockSeconds(value) {
  const parts = String(value || "")
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.NaN;
}

function playbackTotalSeconds(timeText) {
  return clockSeconds(String(timeText || "").split("/").pop());
}

test("/routes lists every recommended catalog route", async ({ page }) => {
  await page.goto("/routes");
  await expect(page.locator(".routes-page")).toBeVisible();
  await expect(page.locator(".routes-page__filter-group", { hasText: "נקודת התחלה" })).toBeVisible();
  await expect(page.locator(".routes-page__filter-group", { hasText: "עובר דרך" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "סובב בית הלל" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "בניאס" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "הירדן ההיסטורי" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "מסע בעקבות כובשי הגולן" })).toBeVisible();

  await expect(
    page.locator(".route-card", { hasText: "סובב דפנה" }).locator(".route-card__badges"),
  ).toContainText("מעגלי");
  await expect(
    page.locator(".route-card", { hasText: "מסע בעקבות כובשי הגולן" }).locator(".route-card__badges"),
  ).toContainText("חד כיווני");
  await expect(
    page.locator(".route-card", { hasText: "הירדן ההיסטורי" }).locator(".route-card__stats"),
  ).toContainText("בינוני");
  await expect(
    page.locator(".route-card", { hasText: "הירדן ההיסטורי" }).locator(".route-card__stats"),
  ).toContainText("שטח");
  await expect(
    page.locator(".route-card", { hasText: "בניאס וגן הצפון" }).locator(".route-card__stats"),
  ).toContainText("סלול/שטח");
});

test("/routes filters by possible start location", async ({ page }) => {
  await page.goto("/routes");
  const startLocation = page.locator(".routes-page__filter-group", { hasText: "נקודת התחלה" });
  await startLocation.getByRole("button", { name: "הגושרים", exact: true }).click();

  await expect(page.locator(".route-card")).toHaveCount(2);
  await expect(page.locator(".route-card", { hasText: "בניאס וגן הצפון" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "סובב דפנה" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "סובב בית הלל" })).toHaveCount(0);
});

test("/routes filters by goes-through location", async ({ page }) => {
  await page.goto("/routes");
  const throughLocation = page.locator(".routes-page__filter-group", { hasText: "עובר דרך" });
  await throughLocation.getByRole("button", { name: "אגמון החולה", exact: true }).click();

  await expect(page.locator(".route-card")).toHaveCount(1);
  await expect(page.locator(".route-card", { hasText: "הירדן ההיסטורי" })).toBeVisible();
});

test("/routes card opens planner and detail actions", async ({ page }) => {
  await page.goto("/routes");
  const historic = page.locator(".route-card", { hasText: "הירדן ההיסטורי" });
  await expect(historic.getByRole("link", { name: "פתח במפה" })).toHaveAttribute("href", /route=/);
  await expect(
    historic.getByRole("link", { name: "פתח פרטי מסלול: הירדן ההיסטורי" }),
  ).toHaveAttribute("href", "/routes/historic-jordan");
  await historic.getByRole("link", { name: "פתח פרטי מסלול: הירדן ההיסטורי" }).click();
  await expect(page).toHaveURL(/\/routes\/historic-jordan$/);
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("הירדן ההיסטורי");
  await expect(page.locator(".fv-playback")).toBeVisible();
  await expect(page.locator(".fv-video-shell--map")).toBeVisible();
  await expect(page.locator(".fv-route-map-playback")).toBeVisible();
  await expect(page.locator(".fv-route-stage-map")).toBeVisible();
  await expect(page.locator(".fv-video-controls")).toBeVisible();
  await expect(page.locator(".fv-route-stats")).toBeVisible();
  await expect(page.locator(".elevation-profile")).toBeVisible();
  await expect(page.locator(".nav-links .nav-link")).toHaveText([
    "על המסלול",
    "נקודות במסלול",
    "כל המסלולים",
  ]);
});

test("/routes rich story route keeps story shell", async ({ page }) => {
  await page.goto("/routes/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
  await expect(page.locator(".nav-links .nav-link")).toHaveText([
    "על המסלול",
    "נקודות במסלול",
    "כל המסלולים",
  ]);
});

test("/routes generic route renders from snapshot without planner assets", async ({ page }) => {
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));

  await page.goto("/routes/historic-jordan");
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("הירדן ההיסטורי");
  await expect(page.locator(".fv-video-shell--map")).toBeVisible();
  await expect(page.locator(".fv-route-map-playback")).toBeVisible();
  await expect(page.locator(".fv-route-stage-map")).toBeVisible();
  await expect(page.locator(".fv-video-controls")).toBeVisible();
  await expect(page.locator(".fv-route-actions .fv-route-action--primary")).toContainText("נגן מסלול");
  await expect(page.locator(".fv-route-stats")).toContainText("בינוני");
  await expect(page.locator(".fv-route-stats")).toContainText("שטח");
  await expect(page.locator(".fv-video .featured-video-frame")).toHaveCount(0);
  await expect(page.locator(".fv-video-poi-preview")).toBeVisible();
  const routeFitPadding = await page.evaluate(() => {
    const fitEvents = window.__mockMapboxEvents?.filter((event) =>
      event.type === "fitBounds" && typeof event.options?.padding === "object"
    ) || [];
    return fitEvents.at(-1)?.options?.padding || null;
  });
  expect(routeFitPadding).toEqual({
    top: 24,
    right: 24,
    bottom: 108,
    left: 24,
  });
  await expect(page.locator(".fv-route-warning-card")).toHaveCount(4);
  await expect(page.locator(".fv-route-warnings")).toContainText("ירדן מערב כפר בלום");
  await expect(page.locator(".fv-route-warnings")).toContainText("אגמון החולה גישה מזרח");
  await expect(page.locator(".fv-route-warnings")).toContainText("שדות עמיר מערב");

  const sectionOrder = await page.evaluate(() => {
    const about = document.querySelector("#fv-about");
    const warnings = document.querySelector("#fv-route-warnings");
    const stories = document.querySelector("#fv-poi-stories");
    return {
      storiesAfterAbout: Boolean(
        about && stories && (about.compareDocumentPosition(stories) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
      warningsAfterStories: Boolean(
        stories && warnings && (stories.compareDocumentPosition(warnings) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
    };
  });
  expect(sectionOrder).toEqual({
    storiesAfterAbout: true,
    warningsAfterStories: true,
  });

  await page.locator(".fv-route-warning-card", { hasText: "אגמון החולה גישה מזרח" }).click();
  await expect(
    page.locator(".fv-route-warning-card--focused", { hasText: "אגמון החולה גישה מזרח" }),
  ).toBeVisible();

  const initialMapPlaybackTime = await page.locator(".fv-video-time").textContent();
  expect(playbackTotalSeconds(initialMapPlaybackTime)).toBeGreaterThanOrEqual(35);
  expect(playbackTotalSeconds(initialMapPlaybackTime)).toBeLessThanOrEqual(80);
  await page.locator(".fv-route-actions .fv-route-action--primary").click();
  await expect(page.locator(".fv-video-play-toggle")).toHaveAttribute("aria-label", "השהה מסלול");
  await expect.poll(
    async () => page.locator(".fv-video-time").textContent(),
    { timeout: 3000 },
  ).not.toBe(initialMapPlaybackTime);

  await page.locator(".fv-video-play-toggle").click();
  await expect(page.locator(".fv-video-play-toggle")).toHaveAttribute("aria-label", "נגן מסלול");
  await page.locator(".fv-video-scrubber").evaluate((input) => {
    input.value = String(Number(input.max) / 2);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator(".fv-video-progress-value")).not.toHaveText("0 מ׳");

  expect(
    requestedUrls.some((url) =>
      url.includes("public-data/featured-routes/historic-jordan.json"),
    ),
    `expected the historic-jordan snapshot to be requested; saw:\n${requestedUrls.join("\n")}`,
  ).toBe(true);

  for (const pattern of [
    "bike_roads.geojson",
    "segments.json",
    "cw-base-index.json",
    "base-routing-shards/",
  ]) {
    const offenders = requestedUrls.filter((url) => url.includes(pattern));
    expect(
      offenders,
      `map-stage route page must not request "${pattern}", but saw:\n${offenders.join("\n")}`,
    ).toEqual([]);
  }
});

test("/routes promoted video route renders the video template", async ({ page }) => {
  const requestedUrls = [];
  page.on("request", (request) => requestedUrls.push(request.url()));

  await page.goto("/routes/sovev-dafna");
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב דפנה");
  await expect(page.locator(".fv-video .featured-video-frame")).toBeVisible();
  await expect(page.locator(".fv-video-shell--map")).toHaveCount(0);
  await expect(page.locator(".fv-route-warning-card")).toHaveCount(2);
  await expect(
    page.locator(".fv-route-warning-card", { hasText: "שער יציאה מדפנה למטעים" }),
  ).toBeVisible();
  const figWarning = page.locator(".fv-route-warning-card", { hasText: "תאנים ושיחי פטל" });
  await expect(figWarning).toBeVisible();
  await expect(figWarning.locator("img")).toHaveCount(1);

  expect(
    requestedUrls.some((url) => url.includes("public-data/route-videos/index.json")),
    `expected route video index to be requested; saw:\n${requestedUrls.join("\n")}`,
  ).toBe(true);
  expect(
    requestedUrls.some((url) => url.includes("public-data/route-videos/sovev-dafna.json")),
    `expected sovev-dafna video keyframes to be requested; saw:\n${requestedUrls.join("\n")}`,
  ).toBe(true);
});

test("/routes detail stats show computed route shape", async ({ page }) => {
  await page.goto("/routes/kovshey-hagolan");
  await expect(page.locator(".featured-route-header h1")).toContainText("מסע בעקבות כובשי הגולן");
  await expect(page.locator(".fv-route-stats")).toContainText("סוג");
  await expect(page.locator(".fv-route-stats")).toContainText("חד כיווני");
});
