import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

function routeCardByTitle(page, title) {
  return page.locator(".route-card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function expectedRouteFitPadding(page) {
  return page.locator(".fv-route-map-playback").evaluate((section) => {
    const map = section.querySelector(".fv-route-stage-map");
    if (!map) return null;
    const mapRect = map.getBoundingClientRect();
    const edges = ["top", "right", "bottom", "left"];
    const padding = { top: 24, right: 24, bottom: 24, left: 24 };
    const rectsOverlap = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const nearestEdge = (rect) => {
      const gaps = {
        top: rect.top - mapRect.top,
        bottom: mapRect.bottom - rect.bottom,
        left: rect.left - mapRect.left,
        right: mapRect.right - rect.right,
      };
      return edges.reduce((best, edge) => (gaps[edge] < gaps[best] ? edge : best), "top");
    };
    const insetForEdge = (edge, rect) => {
      if (edge === "top") return rect.bottom - mapRect.top;
      if (edge === "bottom") return mapRect.bottom - rect.top;
      if (edge === "left") return rect.right - mapRect.left;
      if (edge === "right") return mapRect.right - rect.left;
      return 0;
    };
    const overlays = [
      { el: section.querySelector(".fv-video-controls"), side: "bottom" },
      { el: section.querySelector(".fv-video-poi-preview") },
    ];
    for (const { el, side } of overlays) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        el.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        !rectsOverlap(mapRect, rect)
      ) {
        continue;
      }
      const edge = edges.includes(side) ? side : nearestEdge(rect);
      padding[edge] = Math.max(padding[edge], Math.max(0, insetForEdge(edge, rect)) + 16);
    }
    return padding;
  });
}

test("/routes lists every recommended catalog route", async ({ page, isMobile }) => {
  await page.goto("/routes");
  await expect(page.locator(".routes-page")).toBeVisible();
  await expect(page.locator(".routes-page__eyebrow .breadcrumbs")).toContainText("מפה");
  await expect(page.locator(".routes-page__eyebrow .breadcrumbs")).toContainText("מסלולים");
  if (isMobile) {
    await page.getByRole("button", { name: "סינון וחיפוש" }).click();
  }
  await expect(page.getByLabel("התחלה", { exact: true })).toBeVisible();
  await expect(page.getByLabel("עובר דרך", { exact: true })).toBeVisible();
  await expect(routeCardByTitle(page, "סובב בית הלל")).toBeVisible();
  await expect(routeCardByTitle(page, "בניאס וגן הצפון")).toBeVisible();
  await expect(routeCardByTitle(page, "הירדן ההיסטורי")).toBeVisible();
  await expect(routeCardByTitle(page, "מסע בעקבות כובשי הגולן")).toBeVisible();

  await expect(
    routeCardByTitle(page, "סובב דפנה").locator(".route-card__badges"),
  ).toContainText("מעגלי");
  await expect(
    routeCardByTitle(page, "מסע בעקבות כובשי הגולן").locator(".route-card__badges"),
  ).toContainText("חד כיווני");
  await expect(
    routeCardByTitle(page, "הירדן ההיסטורי").locator(".route-card__stats"),
  ).toContainText("בינוני");
  await expect(
    routeCardByTitle(page, "הירדן ההיסטורי").locator(".route-card__stats"),
  ).toContainText("שטח");
  await expect(
    routeCardByTitle(page, "בניאס וגן הצפון").locator(".route-card__stats"),
  ).toContainText("סלול/שטח");
  const firstThreeRouteTitles = await page
    .locator(".route-card__header h2, .route-card__header h3")
    .evaluateAll((headings) => headings.slice(0, 3).map((heading) => heading.textContent.trim()));
  expect(firstThreeRouteTitles).toEqual([
    "סובב בית הלל",
    "בניאס וגן הצפון",
    "סובב דפנה",
  ]);
});

test("/routes filters by possible start location", async ({ page, isMobile }) => {
  await page.goto("/routes");
  // On mobile the filter panel is collapsed behind a toggle; open it first.
  if (isMobile) {
    await page.getByRole("button", { name: "סינון וחיפוש" }).click();
  }
  const startLocation = page.getByLabel("התחלה", { exact: true });
  await startLocation.fill("הגושרים");
  await startLocation.press("Enter");

  await expect(page.locator(".route-card")).toHaveCount(2);
  await expect(routeCardByTitle(page, "בניאס וגן הצפון")).toBeVisible();
  await expect(routeCardByTitle(page, "סובב דפנה")).toBeVisible();
  await expect(routeCardByTitle(page, "סובב בית הלל")).toHaveCount(0);
});

test("/routes filters by goes-through location", async ({ page, isMobile }) => {
  await page.goto("/routes");
  // On mobile the filter panel is collapsed behind a toggle; open it first.
  if (isMobile) {
    await page.getByRole("button", { name: "סינון וחיפוש" }).click();
  }
  const throughLocation = page.getByLabel("עובר דרך", { exact: true });
  await throughLocation.fill("אגמון החולה");
  await throughLocation.press("Enter");

  await expect(page.locator(".route-card")).toHaveCount(1);
  await expect(routeCardByTitle(page, "הירדן ההיסטורי")).toBeVisible();
});

test("/routes card opens planner and detail actions", async ({ page }) => {
  await page.goto("/routes");
  const historic = routeCardByTitle(page, "הירדן ההיסטורי");
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
  await expect(page.getByRole("button", { name: "מדריך", exact: true })).toHaveCount(0);
  await expect(page.locator(".featured-route-header .breadcrumbs")).toContainText("הירדן ההיסטורי");
});

test("/routes rich story route keeps story shell", async ({ page }) => {
  await page.goto("/routes/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
  await expect(page.locator(".nav-links .nav-link")).toHaveText([
    "על המסלול",
    "נקודות במסלול",
    "כל המסלולים",
  ]);
  await expect(page.getByRole("button", { name: "מדריך", exact: true })).toHaveCount(0);
  await expect(page.locator(".featured-route-header .breadcrumbs")).toContainText("סובב בית הלל");
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
  await expect(page.locator(".fv-route-panel")).toContainText(
    "רכיבה מכפר בלום לאורך הירדן ההיסטורי ששוקם",
  );
  await expect(page.locator("#fv-about")).toContainText("רכיבה על גדות הירדן");
  await expect(page.locator(".fv-route-stats")).toContainText("בינוני");
  await expect(page.locator(".fv-route-stats")).toContainText("שטח");
  await expect(page.locator(".fv-video .featured-video-frame")).toHaveCount(0);
  await expect(page.locator(".fv-video-poi-preview")).toBeVisible();
  await expect(
    page.locator(".fv-route-stage-map .route-endpoint-marker--circular"),
  ).toHaveCount(1);
  const expandButtonBox = await page
    .locator(".fv-route-map-playback .featured-map-expand-btn")
    .boundingBox();
  const previewBox = await page
    .locator(".fv-route-map-playback .fv-video-poi-preview")
    .boundingBox();
  expect(expandButtonBox.x).toBeGreaterThan(previewBox.x + previewBox.width);
  const routeFitPadding = await page.evaluate(() => {
    const fitEvents = window.__mockMapboxEvents?.filter((event) =>
      event.type === "fitBounds" && typeof event.options?.padding === "object"
    ) || [];
    return fitEvents.at(-1)?.options?.padding || null;
  });
  expect(routeFitPadding).toEqual(await expectedRouteFitPadding(page));
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
  expect(initialMapPlaybackTime).toMatch(
    /^\s*\d+(\.\d+)?\s*(m|km)\s*\/\s*\d+(\.\d+)?\s*km\s*$/,
  );
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
  const scrubbedReadout = await page.locator(".fv-video-time").textContent();
  const scrubbedProgress = scrubbedReadout.split("/")[0].trim();
  expect(scrubbedProgress).not.toMatch(/^0\s*(m|km)$/);

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
  const figWarning = page.locator(".fv-route-warning-card", { hasText: "עצי תאנה ושיחי פטל" });
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
  await expect(page.locator(".featured-route-header .breadcrumbs")).toContainText("מסלולים");
  await expect(page.locator(".featured-route-header .breadcrumbs")).toContainText("מסע בעקבות כובשי הגולן");
  await expect(page.locator(".fv-route-stage-map .route-endpoint-marker--start")).toHaveCount(1);
  await expect(page.locator(".fv-route-stage-map .route-endpoint-marker--end")).toHaveCount(1);
  await expect(page.locator(".fv-route-stats")).toContainText("סוג");
  await expect(page.locator(".fv-route-stats")).toContainText("חד כיווני");
  const stagePlacement = await page.locator(".fv-video-shell--map").evaluate((stage) => {
    const rect = stage.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      top: rect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
  expect(stagePlacement.top).toBeLessThan(stagePlacement.viewportHeight);
  if (stagePlacement.viewportWidth >= 900) {
    expect(stagePlacement.bottom).toBeLessThanOrEqual(stagePlacement.viewportHeight + 2);
  }
});
