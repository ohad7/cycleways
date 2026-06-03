# Banias / Gan HaTzafon Featured Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a video-first featured page for `banias-gan-hatsafon`, and in doing so generalize the sovev page's scaffold into a reusable `FeaturedVideoRoute` template so future featured pages differ only in content.

**Architecture:** The five featured sub-components (`VideoEmbed`, `RoutePoiStoryList`, `RoutePoiVideoPreview`, `RoutePoiGallery`, `FeaturedRouteMap`) are already generic — only the `sbh-` (sovev-beit-hillel) CSS prefix and the scaffold hand-written in `sovev-beit-hillel.jsx` are route-specific. We (1) rename `sbh-` → `fv-` everywhere, (2) extract the scaffold into `FeaturedVideoRoute` driven by content props, rewriting sovev to use it, then (3) add the banias page + registration. Route data (video, map, start image, POIs) already flows in from the catalog and `route-videos/`.

**Tech Stack:** React (Vite), React Router, Playwright e2e (`tests/e2e`), plain CSS (`src/components/featured/featured.css`).

---

## Background / key facts (read before starting)

- A featured page is a `.jsx` in `src/featured/` registered in `src/featured/index.js`
  (`moduleLoaders` + `moduleNav`). `src/pages/FeaturedRoutePage.jsx` lazy-loads it.
- `banias-gan-hatsafon` is **already** `featured: true` in
  `public-data/route-catalog.json` (with a `start` point + WebP image) and
  **already** has a synced ride-along video at
  `public-data/route-videos/banias-gan-hatsafon.json` registered in
  `index.json`. **Do not edit any `public-data/` file** — it is pipeline-owned.
- The `sbh-` prefix appears in exactly these files (verified by
  `grep -rn "sbh-" src/ tests/`):
  - `src/components/featured/featured.css`
  - `src/components/featured/RoutePoiGallery.jsx`
  - `src/components/featured/RoutePoiStoryList.jsx`
  - `src/components/featured/FeaturedRouteMap.jsx`
  - `src/components/featured/RoutePoiVideoPreview.jsx`
  - `src/components/featured/VideoEmbed.jsx`
  - `src/featured/index.js`
  - `src/featured/sovev-beit-hillel.jsx`
  - `tests/e2e/featured-route-slots.spec.mjs`
  - `tests/e2e/featured-route-layout.spec.mjs`
- The CSS custom property `--sbh-video-progress` and the anchor ids
  `sbh-about` / `sbh-poi-stories` all contain the literal `sbh-`, so a single
  `sbh-` → `fv-` replacement covers them too (giving `--fv-video-progress`,
  `fv-about`, `fv-poi-stories`).
- Playwright smoke (`npm run test:smoke`) boots its own dev server on port 5175
  (webServer in `playwright.config.js`, `reuseExistingServer` locally) and runs
  `desktop` + `mobile` projects. Filter to one spec with a trailing substring,
  e.g. `npm run test:smoke -- featured-route-slots`.

---

## Task 1: Rename the `sbh-` CSS prefix to `fv-` (atomic, behavior-preserving)

The CSS class names and the JSX/test selectors are coupled, so they must change
together in one commit or styling/tests break between commits.

**Files (modify):**
- `src/components/featured/featured.css`
- `src/components/featured/RoutePoiGallery.jsx`
- `src/components/featured/RoutePoiStoryList.jsx`
- `src/components/featured/FeaturedRouteMap.jsx`
- `src/components/featured/RoutePoiVideoPreview.jsx`
- `src/components/featured/VideoEmbed.jsx`
- `src/featured/index.js`
- `src/featured/sovev-beit-hillel.jsx`
- `tests/e2e/featured-route-slots.spec.mjs`
- `tests/e2e/featured-route-layout.spec.mjs`

- [ ] **Step 1: Apply the global rename**

Run (from repo root):

```bash
perl -pi -e 's/sbh-/fv-/g' \
  src/components/featured/featured.css \
  src/components/featured/RoutePoiGallery.jsx \
  src/components/featured/RoutePoiStoryList.jsx \
  src/components/featured/FeaturedRouteMap.jsx \
  src/components/featured/RoutePoiVideoPreview.jsx \
  src/components/featured/VideoEmbed.jsx \
  src/featured/index.js \
  src/featured/sovev-beit-hillel.jsx \
  tests/e2e/featured-route-slots.spec.mjs \
  tests/e2e/featured-route-layout.spec.mjs
```

- [ ] **Step 2: Verify no `sbh-` remains and no stray `sbh` identifiers were missed**

Run:

```bash
grep -rn "sbh-" src/ tests/ ; echo "exit: $?"
grep -rn "sbh" src/ tests/
```

Expected: the first `grep` prints nothing and `exit: 1` (no matches). The second
`grep` also prints nothing (there are no non-prefixed `sbh` identifiers in these
files). If the second finds anything, inspect and rename it by hand to `fv`.

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds (Vite build + `copy-static-assets.mjs`), no errors.

- [ ] **Step 4: Verify the sovev page still renders (regression net)**

Run: `npm run test:smoke -- featured-route-slots featured-route-layout`
Expected: PASS. These now assert `.fv-playback`, `.fv-route-panel`,
`.fv-poi-stories`, `.fv-video`, `.fv-side-map`, etc. — proving the renamed
classes still match the rendered DOM.

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/featured.css src/components/featured/RoutePoiGallery.jsx \
  src/components/featured/RoutePoiStoryList.jsx src/components/featured/FeaturedRouteMap.jsx \
  src/components/featured/RoutePoiVideoPreview.jsx src/components/featured/VideoEmbed.jsx \
  src/featured/index.js src/featured/sovev-beit-hillel.jsx \
  tests/e2e/featured-route-slots.spec.mjs tests/e2e/featured-route-layout.spec.mjs
git commit -m "refactor(featured): rename sbh- CSS prefix to neutral fv- prefix"
```

---

## Task 2: Extract the `FeaturedVideoRoute` template and rewrite sovev to use it

**Files:**
- Create: `src/components/featured/FeaturedVideoRoute.jsx`
- Modify: `src/featured/sovev-beit-hillel.jsx`

- [ ] **Step 1: Create the template component**

Create `src/components/featured/FeaturedVideoRoute.jsx` with the exact content
below. It is the scaffold formerly inlined in `sovev-beit-hillel.jsx`, now using
the `fv-` classes (from Task 1) and accepting content via props. `intro.body` and
`about.paragraphs` are arrays of strings, each rendered as a `<p>`.

```jsx
import React from "react";
import FeaturedRoute from "./FeaturedRoute.jsx";

// Shared video-first featured-route template. The video player, maps, POI
// preview, progress readout, and POI story list are identical across routes;
// only the editorial copy differs and comes in via the `intro`/`about` props.
//
//   intro: { kicker?, heading?, body?: string[] }   — side "what's on the ride" panel
//   about: { eyebrow?, heading?, paragraphs?: string[] } — below-the-fold "about" section
export default function FeaturedVideoRoute({ slug, kicker = null, intro = {}, about = {} }) {
  return (
    <FeaturedRoute slug={slug} layout="video-first" desktopMap="manual" kicker={kicker}>
      <section className="fv-playback" aria-label="סרטון, תיאור ומפת המסלול">
        <div className="fv-video-stage">
          <div className="fv-video-shell">
            <FeaturedRoute.Video title="" className="fv-video" />
            <FeaturedRoute.POIVideoPreview />
            <FeaturedRoute.Map
              className="fv-mobile-map"
              autoResetAfterInteraction
              autoResetDelayMs={5000}
              routeFitPadding={12}
            />
          </div>
        </div>

        <aside className="fv-side-rail" aria-label="תיאור ומפת המסלול">
          <section className="fv-route-panel" aria-label="תקציר המסלול">
            {intro.kicker && <span className="fv-route-panel-kicker">{intro.kicker}</span>}
            {intro.heading && <h2>{intro.heading}</h2>}
            {(intro.body || []).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </section>

          <div className="fv-side-map-wrap">
            <div className="fv-side-heading">
              <span>מרחק מההתחלה</span>
              <FeaturedRoute.ProgressDistance />
            </div>
            <FeaturedRoute.Map
              variant="desktop"
              className="fv-side-map"
              autoResetAfterInteraction
              routeFitPadding={22}
            />
          </div>
        </aside>
      </section>

      <section id="fv-about" className="fv-route-about" aria-label="על המסלול">
        <div className="fv-route-about-heading">
          {about.eyebrow && <span>{about.eyebrow}</span>}
          {about.heading && <h2>{about.heading}</h2>}
        </div>
        <div className="fv-route-about-body">
          {(about.paragraphs || []).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </section>

      <FeaturedRoute.POIStories />
    </FeaturedRoute>
  );
}
```

- [ ] **Step 2: Rewrite the sovev page to use the template**

Replace the entire contents of `src/featured/sovev-beit-hillel.jsx` with the
following. The prose is the same copy that previously lived in the inline JSX
(the intro's single `<p>` with `<br><br>` is split into two `body` paragraphs).

```jsx
import React from "react";
import FeaturedVideoRoute from "../components/featured/FeaturedVideoRoute.jsx";

export default function SovevBeitHillel() {
  return (
    <FeaturedVideoRoute
      slug="sovev-beit-hillel"
      kicker="גליל עליון · רכיבה רגועה"
      intro={{
        kicker: "רכיבה רגועה בגליל העליון",
        heading: "מה מחכה בדרך",
        body: [
          "רכיבה קצרה ונעימה בגדר ההיקפית ובשביל האופניים של בית בית הלל: חופי רחצה על נחל שניר, שדות חקלאיים, חוות סוסים קטנות ונוף לחרמון ולהרי נפתלי.",
          "מתאים למשפחות: רוב המסלול עובר בדרכים שקטות או מופרדות ממכוניות",
        ],
      }}
      about={{
        eyebrow: "על המסלול",
        heading: "לולאה רגועה בלב הגליל העליון",
        paragraphs: [
          "סובב בית הלל הוא מסלול קצר ונעים בלב הגליל העליון, מהסוג שמתאים כמעט לכולם - משפחות עם ילדים, רוכבים מתחילים, או כל מי שמחפש רכיבה יפה בלי מאמץ טכני. הדרך עוברת ברובה על כביש המערכת של בית הלל ושביל האופניים שצמוד לנחל שניר",
          "בנחל שניר (החצבאני) תוכלו להנות מרכיבה נעימה, חלק ניכר מוצל ומתאים גם לקיץ. הכניסות לחופים מסומנות בשערים ממוספרים, יש מים קרירים וזורמים גם בלב הקיץ, וגדות מוצלות תחת עצי דולב, אקליפטוס ותות. קל לשלב את הרכיבה עם עצירת רחצה, פיקניק על הגדה, או סתם רגע של שקט ליד המים.",
          "לקראת אמצע המסלול אפשר לעצור בקפה פקישטיק שהוא ממש על המסלול או באחד מהמסעדות ובתי הקפה שמצויים בישוב (צ׳יז, תאי גארדן, לה קוסטיקה) יש גם חנות אופניים נהדרת, מפגש האופניים במרחק הליכה מרוב המסלול, במידה ונתקעתם עם פנצ׳ר",
          "מקווים שתהנו!",
        ],
      }}
    />
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 4: Verify sovev renders identically through the template**

Run: `npm run test:smoke -- featured-route-slots featured-route-layout featured-route-shell`
Expected: PASS. Same DOM (`.fv-playback`, `.fv-route-panel`, `.fv-poi-stories`,
side map, video controls, POI preview, "התחלה"/"חוף קולומביה" stories) as
before the refactor, header still "סובב בית הלל".

- [ ] **Step 5: Commit**

```bash
git add src/components/featured/FeaturedVideoRoute.jsx src/featured/sovev-beit-hillel.jsx
git commit -m "refactor(featured): extract FeaturedVideoRoute template; sovev uses it"
```

---

## Task 3: Add the banias-gan-hatsafon page (TDD via e2e)

**Files:**
- Create (test): `tests/e2e/featured-banias.spec.mjs`
- Create: `src/featured/banias-gan-hatsafon.jsx`
- Modify: `src/featured/index.js`

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/featured-banias.spec.mjs` with exactly:

```javascript
import { test, expect } from "@playwright/test";

test("banias gan hatsafon featured page renders the video-first shell", async ({ page }) => {
  await page.goto("/featured/banias-gan-hatsafon");
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".fv-playback")).toBeVisible();
  await expect(page.locator(".fv-route-panel")).toBeVisible();
  await expect(page.locator(".fv-poi-stories")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("בניאס");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:smoke -- featured-banias`
Expected: FAIL. The slug has no registered module, so
`src/pages/FeaturedRoutePage.jsx` renders `.featured-route-404` and
`.featured-route-video-first` is never visible (timeout on the first
`toBeVisible`).

- [ ] **Step 3: Create the banias page**

Create `src/featured/banias-gan-hatsafon.jsx` with the content below. The prose
is a draft (sourced from the catalog summary, the `start` description — שער
שדה נחמיה — and the route facts: 14.8 km, paved, family, מעגלי); the user will
edit it afterward.

```jsx
import React from "react";
import FeaturedVideoRoute from "../components/featured/FeaturedVideoRoute.jsx";

export default function BaniasGanHatsafon() {
  return (
    <FeaturedVideoRoute
      slug="banias-gan-hatsafon"
      kicker="גליל עליון · רכיבה למשפחות"
      intro={{
        kicker: "רכיבה מעגלית רגועה",
        heading: "מה מחכה בדרך",
        body: [
          "מסלול מעגלי קצר ונוח לאורך אזור הבניאס וגן הצפון, כולו על דרכים סלולות ונעימות. בדרך משתלבים נחלים, שדות ופינות מנוחה רבות.",
          "מתאים במיוחד לרוכבים מתחילים ולמשפחות: כ-14.8 ק״מ כמעט ללא טיפוס, עם הרבה מקומות לעצור, לנוח וליהנות.",
        ],
      }}
      about={{
        eyebrow: "על המסלול",
        heading: "סיבוב מעגלי רגוע סביב הבניאס וגן הצפון",
        paragraphs: [
          "המסלול יוצא משער הכניסה הצהוב של שדה נחמיה, שלצדו חניית כורכר רחבה. מיד לפני הבוטקה פונים שמאלה לכיוון גשר הולכי הרגל, וממנו ימינה לכיוון הנחל - וכאן מתחילה הרכיבה.",
          "הדרך נוחה וסלולה כמעט לכל אורכה, עם שיפועים מתונים בלבד, ומתאימה גם לרוכבים שרק מתחילים. לאורך הדרך פזורות פינות מנוחה רבות, חלקן מוצלות ולצד המים, שמזמינות עצירה קצרה לפיקניק או לרגע של שקט.",
          "זהו מסלול מעגלי, כך שמסיימים בדיוק במקום שבו התחלתם. קל לשלב אותו עם ביקור בסביבת הבניאס וגן הצפון.",
          "מקווים שתהנו!",
        ],
      }}
    />
  );
}
```

- [ ] **Step 4: Register the page loader and nav links**

In `src/featured/index.js`, add the banias entry to `moduleLoaders`:

```javascript
const moduleLoaders = {
  "sovev-beit-hillel":     () => import("./sovev-beit-hillel.jsx"),
  "banias-gan-hatsafon":   () => import("./banias-gan-hatsafon.jsx"),
  "shdeh-nehemia-baniyas": () => import("./shdeh-nehemia-baniyas.jsx"),
};
```

And add its nav links to `moduleNav` (anchors match the template's `fv-about`
and `fv-poi-stories` ids; mirrors the sovev entry which Task 1 renamed to
`#fv-about` / `#fv-poi-stories`):

```javascript
  "banias-gan-hatsafon": [
    { label: "על המסלול", href: "#fv-about" },
    { label: "נקודות במסלול", href: "#fv-poi-stories" },
    { label: "כל השבילים", to: "/" },
  ],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:smoke -- featured-banias`
Expected: PASS — the page now renders the video-first shell, intro panel, POI
stories, and an `<h1>` containing "בניאס" (from the catalog `name`).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/featured-banias.spec.mjs src/featured/banias-gan-hatsafon.jsx src/featured/index.js
git commit -m "feat(featured): add banias-gan-hatsafon featured page"
```

---

## Task 4: Full featured smoke pass

- [ ] **Step 1: Run the whole featured e2e suite**

Run: `npm run test:smoke -- featured`
Expected: PASS for all `tests/e2e/featured-*.spec.mjs` (index, routing, shell,
slots, layout, banias) across the `desktop` and `mobile` projects. The
`/featured` gallery test still finds the "סובב בית הלל" and "שדה נחמיה" cards
(it filters by text, no exact count, so the added banias card is harmless).

- [ ] **Step 2: Final `sbh-` sweep**

Run: `grep -rn "sbh" src/ tests/ ; echo "exit: $?"`
Expected: nothing printed, `exit: 1`.

- [ ] **Step 3: Manual visual check (optional but recommended)**

Run: `npm run dev` and open `http://127.0.0.1:5173/featured/banias-gan-hatsafon`.
Confirm: header title, ride-along video (YouTube `S8H2zx_Cnt0`) with synced map,
intro panel copy, "מרחק מההתחלה" progress, the start endpoint card + the one POI
in the story list, and the "על המסלול" section. Then open
`/featured/sovev-beit-hillel` and confirm it looks unchanged.

---

## Self-review notes

- **Spec coverage:** template extraction (Task 2) ✓; `sbh-`→`fv-` rename incl.
  CSS var + anchor ids + nav + e2e selectors (Task 1) ✓; new page + registration
  (Task 3) ✓; drafted Hebrew content (Task 3) ✓; sovev rewritten to prove the
  template (Task 2) ✓; "more POIs later" needs no page change (data-driven via
  `routeState.activeDataPoints`) ✓.
- **No public-data edits:** the plan touches only `src/` and `tests/`; catalog,
  video keyframes, and images already exist and are left untouched ✓.
- **Type/name consistency:** template prop shape (`intro {kicker,heading,body[]}`,
  `about {eyebrow,heading,paragraphs[]}`) is identical in the template, sovev,
  and banias usages; `fv-` ids (`fv-about`, `fv-poi-stories`) match between the
  template, the nav entries, and the renamed `RoutePoiStoryList` id ✓.
- **Ordering:** rename is atomic (Task 1) before the template extraction (Task 2)
  so no commit leaves CSS and markup out of sync ✓.
