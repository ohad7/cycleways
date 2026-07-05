# iOS App Store Release Readiness - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-07-05 (supersedes the 2026-07-04 plan; reconciled with the
implemented background-location-voice-guidance work — see `design.md`)

**Goal:** Add every in-repo product surface the App Store release needs:
privacy/terms/support pages on the website, an in-app About screen with
version + attribution, Hebrew permission strings, release compliance config,
Mapbox telemetry opt-out, and a ride safety notice.

**Architecture:** The website is a Vite + React SPA (react-router routes in
`src/main.jsx`, deployed to GitHub Pages). The mobile app is Expo / React
Native under `apps/mobile` (React Navigation stack in
`apps/mobile/src/navigation/RootNavigator.jsx`). Shared constants live in the
`@cycleways/core` workspace package. Tests are plain Node scripts under
`tests/` wired into the root `npm test` chain, plus Playwright specs under
`tests/e2e/`.

**Tech Stack:** React 19, react-router, Vite, Expo SDK 56, React Navigation,
`@rnmapbox/maps` v10, Node test scripts (`node:assert/strict`), Playwright.

## Global Constraints

- Run every command from the repo root `/…/isravelo` unless the step says
  otherwise.
- NEVER edit `data/map-source.geojson`, anything under `public-data/`, or the
  generated `apps/mobile/ios/` native project. They are pipeline/prebuild
  owned.
- Never run `git add -A` or `git add .`. Stage only the files each task names.
- Do not run `npm run build` unless a step says so (it regenerates
  `public-data/` artifacts which must not be committed).
- Site domain is exactly `https://www.cycleways.app`. The support email is
  `ohad.serfaty@gmail.com` and must appear in source only once, in
  `packages/core/src/config/appLinks.js` (Task 1). Pages render it from that
  constant.
- All user-facing copy is Hebrew (RTL). English appears only inside the
  explicitly marked "English summary" sections. Copy all Hebrew strings from
  this plan verbatim — do not re-translate or paraphrase.
- Do NOT touch `apps/mobile/fastlane/`, signing config, App Store metadata, or
  `PrivacyInfo.xcprivacy`. That work is owned by the repo owner (see the
  appendix "Track 2" at the bottom — it is not for you).
- Commit after each task with the exact message given. Do not push.

## Verification commands used throughout

- Node test suite (fast, used as the gate in most tasks — run the single new
  test file, not the whole chain): `node tests/<file>.mjs`
- Full suite (run once at the end): `npm test`
- Playwright (starts its own dev server):
  `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`

---

### Task 1: Shared app links constants in @cycleways/core

**Files:**
- Create: `packages/core/src/config/appLinks.js`
- Create: `tests/test-app-links.mjs`
- Modify: `package.json` (root — test chain)

**Interfaces:**
- Consumes: nothing.
- Produces: named exports `SITE_ORIGIN`, `PRIVACY_URL`, `TERMS_URL`,
  `SUPPORT_URL`, `SUPPORT_EMAIL`, `FEEDBACK_FORM_URL` (all strings), imported
  elsewhere as `import { PRIVACY_URL } from "@cycleways/core/config/appLinks.js"`.
  Later tasks (2, 3, 4, 6) rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/test-app-links.mjs`:

```js
import assert from "node:assert/strict";
import {
  FEEDBACK_FORM_URL,
  PRIVACY_URL,
  SITE_ORIGIN,
  SUPPORT_EMAIL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

assert.equal(SITE_ORIGIN, "https://www.cycleways.app");
assert.equal(PRIVACY_URL, "https://www.cycleways.app/privacy");
assert.equal(TERMS_URL, "https://www.cycleways.app/terms");
assert.equal(SUPPORT_URL, "https://www.cycleways.app/support");
assert.match(SUPPORT_EMAIL, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
assert.ok(FEEDBACK_FORM_URL.startsWith("https://forms.gle/"));

console.log("test-app-links: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/test-app-links.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` (appLinks.js does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/config/appLinks.js`:

```js
// Canonical public URLs and contact points for CycleWays. Single source of
// truth shared by the website pages and the mobile About screen — change the
// support address or domain here only.
export const SITE_ORIGIN = "https://www.cycleways.app";
export const PRIVACY_URL = `${SITE_ORIGIN}/privacy`;
export const TERMS_URL = `${SITE_ORIGIN}/terms`;
export const SUPPORT_URL = `${SITE_ORIGIN}/support`;
export const SUPPORT_EMAIL = "ohad.serfaty@gmail.com";
export const FEEDBACK_FORM_URL = "https://forms.gle/k1k432YKW1Tw16TE7";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-app-links.mjs`
Expected: prints `test-app-links: ok`, exit code 0.

- [ ] **Step 5: Wire the test into the npm test chain**

In the root `package.json`, in the `"test"` script, find the single occurrence
of `&& cd tests &&` near the end and replace it with
`&& node tests/test-app-links.mjs && cd tests &&`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/appLinks.js tests/test-app-links.mjs package.json
git commit -m "feat: shared app links/contact constants in @cycleways/core"
```

---

### Task 2: Legal page shell and the privacy policy page

**Files:**
- Create: `src/pages/legal/LegalPage.jsx`
- Create: `src/pages/legal/legal.css`
- Create: `src/pages/PrivacyPage.jsx`
- Modify: `src/main.jsx` (register the `/privacy` route)
- Test: `tests/e2e/legal-pages.spec.mjs` (new file)

**Interfaces:**
- Consumes: `SUPPORT_EMAIL`, `FEEDBACK_FORM_URL` from Task 1;
  `PageShell` from `src/components/PageShell.jsx` (props: `breadcrumbs`,
  `children`); the `lazyRoute(name, importer)` helper already defined in
  `src/main.jsx`.
- Produces: `LegalPage` component with props
  `{ title: string, updated: string, children }` — Tasks 3 and 4 reuse it
  exactly as defined here. Route `/privacy`.

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/e2e/legal-pages.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("privacy policy page renders in Hebrew with contact address", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "מדיניות פרטיות" }),
  ).toBeVisible();
  await expect(page.getByText("ohad.serfaty@gmail.com").first()).toBeVisible();
  await expect(page.getByText("Mapbox").first()).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: FAIL — the heading is never visible (the `*` route renders the
planner app instead of a privacy page).

- [ ] **Step 3: Create the shared legal page shell**

Create `src/pages/legal/legal.css`:

```css
.legal-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 20px 64px;
  direction: rtl;
  text-align: right;
}

.legal-page h1 {
  font-size: 1.9rem;
  margin-bottom: 4px;
}

.legal-page h2 {
  font-size: 1.2rem;
  margin-top: 28px;
  margin-bottom: 8px;
}

.legal-page p,
.legal-page li {
  line-height: 1.65;
}

.legal-page__updated {
  color: #6b7671;
  font-size: 0.9rem;
  margin-bottom: 20px;
}

.legal-page__english {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid #d9e2de;
  direction: ltr;
  text-align: left;
}
```

Create `src/pages/legal/LegalPage.jsx`:

```jsx
import React, { useEffect } from "react";
import PageShell from "../../components/PageShell.jsx";
import "./legal.css";

// Shared shell for the public legal/support pages (/privacy, /terms,
// /support): site chrome via PageShell, RTL article layout, document title.
export default function LegalPage({ title, updated, children }) {
  useEffect(() => {
    document.title = `${title} — CycleWays`;
  }, [title]);

  return (
    <PageShell breadcrumbs={[{ label: "ראשי", to: "/" }, { label: title }]}>
      <article className="legal-page">
        <h1>{title}</h1>
        {updated ? (
          <p className="legal-page__updated">עדכון אחרון: {updated}</p>
        ) : null}
        {children}
      </article>
    </PageShell>
  );
}
```

- [ ] **Step 4: Create the privacy page**

Create `src/pages/PrivacyPage.jsx`:

```jsx
import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function PrivacyPage() {
  return (
    <LegalPage title="מדיניות פרטיות" updated="5 ביולי 2026">
      <h2>מי אנחנו</h2>
      <p>
        CycleWays ("אנחנו") מפעילה את האתר www.cycleways.app ואת אפליקציית
        CycleWays לתכנון וניווט מסלולי רכיבה על אופניים. מדיניות זו מסבירה איזה
        מידע מעובד בעת השימוש באתר ובאפליקציה, והיכן.
      </p>

      <h2>העיקרון: המידע שלכם נשאר אצלכם</h2>
      <p>
        אין באתר ובאפליקציה חשבונות משתמש, ואין לנו שרתים שאוספים מידע אישי.
        מסלולים שתכננתם, טיוטות והעדפות נשמרים במכשיר שלכם בלבד, ואפשר למחוק
        אותם בכל רגע על ידי מחיקת נתוני האתר בדפדפן או הסרת האפליקציה.
      </p>

      <h2>מיקום</h2>
      <p>
        האפליקציה משתמשת במיקום המכשיר כדי להציג אתכם על המפה, למיין מסלולים
        לפי קרבה, ולהפעיל הנחיות ניווט קוליות — כולל כשהמסך נעול, אם בחרתם
        בכך. נתוני המיקום מעובדים במכשיר בלבד: הם אינם נשלחים אלינו ואינם
        נשמרים לאחר הרכיבה. אפשר לבטל את הרשאת המיקום בכל עת בהגדרות המכשיר;
        האפליקציה תמשיך לעבוד לתכנון מסלולים גם בלי מיקום.
      </p>

      <h2>ספקי צד שלישי</h2>
      <ul>
        <li>
          <strong>Mapbox</strong> — אריחי המפה נטענים משרתי Mapbox, שמקבלים
          בקשות טכניות סטנדרטיות (כגון כתובת IP ואזור המפה המבוקש) בהתאם
          למדיניות הפרטיות של Mapbox. איסוף הטלמטריה של Mapbox באפליקציה
          כבוי.
        </li>
        <li>
          <strong>YouTube</strong> — עמודי מסלול מסוימים כוללים סרטונים
          מוטמעים. בעת ניגון סרטון חלים תנאי השימוש ומדיניות הפרטיות של
          Google/YouTube.
        </li>
        <li>
          <strong>GitHub Pages</strong> — האתר מתארח ב-GitHub Pages, השומרת
          רישומי גישה טכניים סטנדרטיים.
        </li>
      </ul>

      <h2>שיתוף מסלולים</h2>
      <p>
        שיתוף מסלול או ייצוא קובץ GPX נעשה דרך מנגנון השיתוף של המכשיר, לפי
        בחירתכם בלבד, אל היעד שבחרתם.
      </p>

      <h2>אנליטיקה ודיווחי קריסה</h2>
      <p>
        האפליקציה והאתר אינם כוללים כלי אנליטיקה, פרסום או דיווחי קריסה של צד
        שלישי, ואיננו עוקבים אחריכם בין אפליקציות. אם אישרתם ל-Apple לשתף
        נתוני אבחון עם מפתחים, נקבל דוחות קריסה אנונימיים דרך App Store
        Connect.
      </p>

      <h2>ילדים</h2>
      <p>
        איננו אוספים ביודעין מידע אישי מאף אחד, ובכלל זה מילדים.
      </p>

      <h2>שינויים במדיניות</h2>
      <p>
        אם המדיניות תשתנה (למשל אם נוסיף כלי לדיווח קריסות), נעדכן עמוד זה ואת
        תאריך העדכון שבראשו לפני שהשינוי ייכנס לתוקף.
      </p>

      <h2>יצירת קשר</h2>
      <p>
        לשאלות פרטיות ולכל בקשה אחרת:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> או{" "}
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
          טופס המשוב שלנו
        </a>
        .
      </p>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          CycleWays (web and iOS app) has no user accounts and no first-party
          data collection: planned routes and preferences stay on your device.
          Device location powers on-map positioning, nearby sorting, and
          turn-by-turn guidance (including with a locked screen, if enabled);
          it is processed on-device only and never sent to us. Third parties:
          Mapbox serves map tiles (standard technical requests; SDK telemetry
          disabled), YouTube plays embedded route videos under Google's
          policies, and GitHub Pages hosts the website. No analytics, ads,
          tracking, or third-party crash reporting. Contact:{" "}
          {SUPPORT_EMAIL}.
        </p>
      </section>
    </LegalPage>
  );
}
```

- [ ] **Step 5: Register the route**

In `src/main.jsx`, below the existing `RouteDetailPage` lazyRoute line, add:

```js
const PrivacyPage = lazyRoute("PrivacyPage", () => import("./pages/PrivacyPage.jsx"));
```

Inside the `<Routes>` element, directly above the `path="*"` route, add:

```jsx
<Route
  path="/privacy"
  element={
    <RouteReady>
      <PrivacyPage />
    </RouteReady>
  }
/>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add src/pages/legal/LegalPage.jsx src/pages/legal/legal.css src/pages/PrivacyPage.jsx src/main.jsx tests/e2e/legal-pages.spec.mjs
git commit -m "feat: privacy policy page at /privacy"
```

---

### Task 3: Terms of use page

**Files:**
- Create: `src/pages/TermsPage.jsx`
- Modify: `src/main.jsx`
- Test: `tests/e2e/legal-pages.spec.mjs` (add a test)

**Interfaces:**
- Consumes: `LegalPage` from Task 2 (`{ title, updated, children }`);
  `SUPPORT_EMAIL`, `FEEDBACK_FORM_URL` from Task 1.
- Produces: route `/terms`.

- [ ] **Step 1: Add the failing test**

Append to `tests/e2e/legal-pages.spec.mjs`:

```js
test("terms of use page renders with safety language", async ({ page }) => {
  await page.goto("/terms");
  await expect(
    page.getByRole("heading", { level: 1, name: "תנאי שימוש" }),
  ).toBeVisible();
  await expect(page.getByText("בטיחות ואחריות").first()).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: the new test FAILS (route not registered); the privacy test still
passes.

- [ ] **Step 3: Create the terms page**

Create `src/pages/TermsPage.jsx`:

```jsx
import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function TermsPage() {
  return (
    <LegalPage title="תנאי שימוש" updated="5 ביולי 2026">
      <h2>הסכמה לתנאים</h2>
      <p>
        השימוש באתר www.cycleways.app ובאפליקציית CycleWays ("השירות") מהווה
        הסכמה לתנאים אלה. אם אינכם מסכימים להם, אנא הימנעו משימוש בשירות.
      </p>

      <h2>מהות השירות</h2>
      <p>
        השירות מציע מידע על מסלולי רכיבה, כלי תכנון מסלולים והנחיות ניווט.
        המידע והמסלולים מסופקים כפי שהם (AS IS), ללא התחייבות לזמינות, לדיוק
        או להתאמה למטרה מסוימת.
      </p>

      <h2>בטיחות ואחריות</h2>
      <p>
        רכיבה על אופניים כרוכה בסיכון. השימוש במסלולים ובהנחיות הניווט הוא
        באחריותכם הבלעדית:
      </p>
      <ul>
        <li>
          תנאי השטח משתנים — שערים ננעלים, שבילים נחסמים, מזג האוויר משפיע.
          מה שמופיע במפה אינו תחליף למה שרואים בשטח.
        </li>
        <li>
          חובה לציית לתמרורים, לחוקי התנועה ולתנאי הדרך בפועל — הם קודמים לכל
          הנחיה מהאפליקציה.
        </li>
        <li>
          ההנחיות הקוליות והמפה הן עזר לתכנון והתמצאות, לא תחליף לשיקול דעת.
          התאימו את הרכיבה ליכולתכם, לציוד ולתנאים.
        </li>
        <li>מומלץ לרכוב עם קסדה, ציוד תקין, מים ואמצעי קשר טעון.</li>
      </ul>
      <p>
        לא נהיה אחראים לכל נזק, ישיר או עקיף, שייגרם כתוצאה מהסתמכות על
        השירות, ככל שהדין מתיר זאת.
      </p>

      <h2>דיוק הנתונים ודיווחים</h2>
      <p>
        אנו משתדלים לשמור על המפה מעודכנת, אך ייתכנו אי-דיוקים. נשמח לדיווחים
        על שערים חסומים, שבילים שאינם עבירים או כל טעות אחרת דרך{" "}
        <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
          טופס המשוב
        </a>
        .
      </p>

      <h2>קניין רוחני</h2>
      <p>
        תכני השירות — המסלולים, התיאורים, הצילומים והעיצוב — שייכים ל-CycleWays
        אלא אם צוין אחרת. נתוני המפה מסופקים על ידי Mapbox ועל בסיס נתוני
        OpenStreetMap ברישיון ODbL, וסרטונים מוטמעים כפופים לתנאי YouTube.
        השימוש בתכנים מותר לצרכים אישיים ולא מסחריים.
      </p>

      <h2>שימוש הוגן</h2>
      <p>
        אין להשתמש בשירות באופן שפוגע בזמינותו או בזכויות של אחרים, ואין
        להעתיק את מסד הנתונים של השירות בהיקף מסחרי ללא הסכמה בכתב.
      </p>

      <h2>שינויים ודין חל</h2>
      <p>
        התנאים עשויים להתעדכן מעת לעת; תאריך העדכון מופיע בראש העמוד. על תנאים
        אלה חלים דיני מדינת ישראל.
      </p>

      <h2>יצירת קשר</h2>
      <p>
        שאלות על התנאים: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          CycleWays provides route information, planning tools, and ride
          guidance AS IS. Cycling is inherently risky: field conditions change,
          and posted signs, traffic law, and actual trail conditions always
          take precedence over app guidance. You ride at your own
          responsibility. Content is owned by CycleWays; map data by Mapbox and
          OpenStreetMap contributors (ODbL). Personal, non-commercial use only.
          Israeli law applies. Contact: {SUPPORT_EMAIL}.
        </p>
      </section>
    </LegalPage>
  );
}
```

- [ ] **Step 4: Register the route**

In `src/main.jsx`, below the `PrivacyPage` lazyRoute line, add:

```js
const TermsPage = lazyRoute("TermsPage", () => import("./pages/TermsPage.jsx"));
```

Inside `<Routes>`, directly below the `/privacy` route you added in Task 2,
add:

```jsx
<Route
  path="/terms"
  element={
    <RouteReady>
      <TermsPage />
    </RouteReady>
  }
/>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/TermsPage.jsx src/main.jsx tests/e2e/legal-pages.spec.mjs
git commit -m "feat: terms of use page at /terms"
```

---

### Task 4: Support page

**Files:**
- Create: `src/pages/SupportPage.jsx`
- Modify: `src/main.jsx`
- Test: `tests/e2e/legal-pages.spec.mjs` (add a test)

**Interfaces:**
- Consumes: `LegalPage` from Task 2; `SUPPORT_EMAIL`, `FEEDBACK_FORM_URL` from
  Task 1.
- Produces: route `/support`. This URL becomes the App Store "Support URL".

- [ ] **Step 1: Add the failing test**

Append to `tests/e2e/legal-pages.spec.mjs`:

```js
test("support page renders with contact channels and credits", async ({ page }) => {
  await page.goto("/support");
  await expect(
    page.getByRole("heading", { level: 1, name: "תמיכה ויצירת קשר" }),
  ).toBeVisible();
  await expect(page.getByText("ohad.serfaty@gmail.com").first()).toBeVisible();
  await expect(page.getByText("OpenStreetMap").first()).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: the new test FAILS; the previous two still pass.

- [ ] **Step 3: Create the support page**

Create `src/pages/SupportPage.jsx`:

```jsx
import React from "react";
import LegalPage from "./legal/LegalPage.jsx";
import {
  FEEDBACK_FORM_URL,
  SUPPORT_EMAIL,
} from "@cycleways/core/config/appLinks.js";

export default function SupportPage() {
  return (
    <LegalPage title="תמיכה ויצירת קשר" updated="5 ביולי 2026">
      <h2>איך יוצרים קשר</h2>
      <ul>
        <li>
          בדוא"ל: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> —
          נשתדל לענות תוך כמה ימים.
        </li>
        <li>
          דרך{" "}
          <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
            טופס המשוב
          </a>{" "}
          — הדרך המהירה לדווח על בעיה במפה או במסלול.
        </li>
      </ul>

      <h2>דיווח על בעיה במפה</h2>
      <p>נשמח במיוחד לדיווחים על:</p>
      <ul>
        <li>שערים או גדרות שחוסמים מעבר ולא מסומנים במפה.</li>
        <li>שבילים שהפכו ללא עבירים (בוץ, צמחייה, סחף).</li>
        <li>שבילים חדשים או מסלולים שכדאי להוסיף.</li>
      </ul>

      <h2>בעיה באפליקציה?</h2>
      <p>
        כשמדווחים על תקלה באפליקציה, ציינו בבקשה את גרסת האפליקציה ומספר
        הבנייה — שניהם מופיעים במסך "אודות" באפליקציה — ואת דגם המכשיר. זה
        עוזר לנו לאתר את הבעיה מהר.
      </p>

      <h2>קרדיטים ומקורות נתונים</h2>
      <ul>
        <li>נתוני מפה: © Mapbox, © OpenStreetMap contributors.</li>
        <li>
          רשת הניווט של CycleWays מבוססת על נתוני OpenStreetMap ברישיון ODbL.
        </li>
        <li>המסלולים, הצילומים והתיאורים: © CycleWays.</li>
      </ul>

      <h2>מסמכים נוספים</h2>
      <ul>
        <li>
          <a href="/privacy">מדיניות פרטיות</a>
        </li>
        <li>
          <a href="/terms">תנאי שימוש</a>
        </li>
      </ul>

      <section className="legal-page__english">
        <h2>English summary</h2>
        <p>
          Support for the CycleWays app and website: email {SUPPORT_EMAIL} or
          use our feedback form. When reporting an app issue, include the app
          version and build number shown on the in-app About screen. Map data
          © Mapbox © OpenStreetMap contributors; the routing network is
          derived from OpenStreetMap data under ODbL.
        </p>
      </section>
    </LegalPage>
  );
}
```

- [ ] **Step 4: Register the route**

In `src/main.jsx`, below the `TermsPage` lazyRoute line, add:

```js
const SupportPage = lazyRoute("SupportPage", () => import("./pages/SupportPage.jsx"));
```

Inside `<Routes>`, directly below the `/terms` route, add:

```jsx
<Route
  path="/support"
  element={
    <RouteReady>
      <SupportPage />
    </RouteReady>
  }
/>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SupportPage.jsx src/main.jsx tests/e2e/legal-pages.spec.mjs
git commit -m "feat: support page at /support"
```

---

### Task 5: Footer links, static SPA shells, and sitemap for the new pages

**Files:**
- Modify: `src/components/ContentSections.jsx` (footer)
- Modify: `scripts/copy-static-assets.mjs` (SPA shells so the pages return
  HTTP 200 on GitHub Pages, not the 404.html fallback)
- Modify: `sitemap.xml`
- Test: `tests/e2e/legal-pages.spec.mjs` (add a test)

**Interfaces:**
- Consumes: routes `/privacy`, `/terms`, `/support` from Tasks 2–4.
- Produces: nothing consumed later.

- [ ] **Step 1: Add the failing test**

Append to `tests/e2e/legal-pages.spec.mjs`:

```js
test("home page footer links to the legal pages", async ({ page, isMobile }) => {
  // The mobile home layout is the full-screen discover list without the
  // content sections + footer, so this check is desktop-only.
  test.skip(isMobile, "footer only renders on the desktop home page");
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "מדיניות פרטיות" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "תנאי שימוש" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "תמיכה" })).toHaveAttribute("href", "/support");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: the new test FAILS (links don't exist); the other three pass.

- [ ] **Step 3: Add the footer links**

In `src/components/ContentSections.jsx`, find the footer:

```jsx
      <footer>
        <div className="footer-content">
          <p>&copy; 2025 CycleWays.app - מפת שבילי אופניים.</p>
          <p>פותח לקהילת רוכבי האופניים בישראל</p>
        </div>
      </footer>
```

and replace it with:

```jsx
      <footer>
        <div className="footer-content">
          <p>&copy; 2025 CycleWays.app - מפת שבילי אופניים.</p>
          <p>פותח לקהילת רוכבי האופניים בישראל</p>
          <p>
            <a href="/privacy">מדיניות פרטיות</a>
            {" · "}
            <a href="/terms">תנאי שימוש</a>
            {" · "}
            <a href="/support">תמיכה</a>
          </p>
        </div>
      </footer>
```

- [ ] **Step 4: Add SPA shells for the new paths**

In `scripts/copy-static-assets.mjs`, find:

```js
  const spaShellDirectories = new Set(["featured", "routes"]);
```

and replace it with:

```js
  const spaShellDirectories = new Set([
    "featured",
    "routes",
    "privacy",
    "terms",
    "support",
  ]);
```

- [ ] **Step 5: Add sitemap entries**

In `sitemap.xml`, directly before the closing `</urlset>` tag, add:

```xml
  <url>
    <loc>https://www.cycleways.app/privacy</loc>
    <lastmod>2026-07-05</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://www.cycleways.app/terms</loc>
    <lastmod>2026-07-05</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://www.cycleways.app/support</loc>
    <lastmod>2026-07-05</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/legal-pages.spec.mjs --project=desktop --workers=1`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add src/components/ContentSections.jsx scripts/copy-static-assets.mjs sitemap.xml tests/e2e/legal-pages.spec.mjs
git commit -m "feat: footer links, SPA shells, and sitemap for legal pages"
```

---

### Task 6: About screen model for the mobile app

**Files:**
- Create: `apps/mobile/src/screens/aboutModel.js`
- Create: `tests/test-about-model.mjs`
- Modify: `package.json` (root — test chain)

**Interfaces:**
- Consumes: `PRIVACY_URL`, `TERMS_URL`, `SUPPORT_URL` from Task 1.
- Produces: `aboutModel({ appVersion, buildNumber })` returning
  `{ versionLine: string, links: Array<{ key, label, url }>, attribution: string[], safetyNotice: string }`.
  Task 7's screen renders exactly this shape.

- [ ] **Step 1: Write the failing test**

Create `tests/test-about-model.mjs`:

```js
import assert from "node:assert/strict";
import { aboutModel } from "../apps/mobile/src/screens/aboutModel.js";
import {
  PRIVACY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

// Version line composes marketing version + build number.
{
  const model = aboutModel({ appVersion: "1.0.0", buildNumber: "7" });
  assert.equal(model.versionLine, "גרסה 1.0.0 (בנייה 7)");
}

// Links point at the canonical site URLs, in privacy/terms/support order.
{
  const model = aboutModel({ appVersion: "1.0.0", buildNumber: "7" });
  assert.deepEqual(
    model.links.map((link) => link.url),
    [PRIVACY_URL, TERMS_URL, SUPPORT_URL],
  );
  for (const link of model.links) {
    assert.ok(link.key.length > 0);
    assert.ok(/[א-ת]/.test(link.label), `Hebrew label for ${link.key}`);
  }
}

// Missing native version info falls back to a dash, never "undefined".
{
  const model = aboutModel({});
  assert.ok(!model.versionLine.includes("undefined"), model.versionLine);
  assert.ok(model.versionLine.includes("—"), model.versionLine);
}

// Attribution covers the map providers and the ODbL-derived routing data.
{
  const model = aboutModel({});
  assert.ok(model.attribution.some((line) => line.includes("Mapbox")));
  assert.ok(model.attribution.some((line) => line.includes("OpenStreetMap")));
  assert.ok(model.attribution.some((line) => line.includes("ODbL")));
  assert.ok(model.safetyNotice.length > 20);
}

console.log("test-about-model: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-about-model.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` (aboutModel.js does not exist).

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/screens/aboutModel.js`:

```js
import {
  PRIVACY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

// Pure presentation model for the About screen, kept out of the component so
// the Node test suite can cover it (same pattern as routeDetailModel.js).
export function aboutModel({ appVersion, buildNumber } = {}) {
  const version = appVersion || "—";
  const build = buildNumber || "—";
  return {
    versionLine: `גרסה ${version} (בנייה ${build})`,
    links: [
      { key: "privacy", label: "מדיניות פרטיות", url: PRIVACY_URL },
      { key: "terms", label: "תנאי שימוש", url: TERMS_URL },
      { key: "support", label: "תמיכה ויצירת קשר", url: SUPPORT_URL },
    ],
    attribution: [
      "נתוני מפה: © Mapbox, © OpenStreetMap contributors",
      "רשת הניווט מבוססת על נתוני OpenStreetMap ברישיון ODbL",
      "המסלולים, הצילומים והתכנים: © CycleWays",
    ],
    safetyNotice:
      "המסלולים וההנחיות באפליקציה הם עזר לתכנון בלבד. רכבו בזהירות, חבשו קסדה, וצייתו לתמרורים, לחוק ולתנאי הדרך — הם קודמים לכל הנחיה מהאפליקציה.",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/test-about-model.mjs`
Expected: prints `test-about-model: ok`, exit code 0.

- [ ] **Step 5: Wire the test into the npm test chain**

In the root `package.json` `"test"` script, find
`&& node tests/test-app-links.mjs && cd tests &&` (added in Task 1) and
replace it with
`&& node tests/test-app-links.mjs && node tests/test-about-model.mjs && cd tests &&`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/aboutModel.js tests/test-about-model.mjs package.json
git commit -m "feat: About screen presentation model"
```

---

### Task 7: About screen UI, navigator registration, and Discover entry point

**Files:**
- Create: `apps/mobile/src/screens/AboutScreen.jsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.jsx`
- Modify: `apps/mobile/src/screens/DiscoverScreen.jsx`
- Modify: `apps/mobile/package.json` + lockfile (via `npx expo install`)

**Interfaces:**
- Consumes: `aboutModel` from Task 6; `BackButton` from
  `apps/mobile/src/screens/BackButton.jsx` (props: `onPress`,
  `accessibilityLabel`); `palette`, `radius`, `space` from
  `apps/mobile/src/planner/theme.js`.
- Produces: React Navigation screen name `"About"`.

- [ ] **Step 1: Install expo-application**

Run: `cd apps/mobile && npx expo install expo-application && cd ../..`
Expected: `expo-application` appears in `apps/mobile/package.json`
dependencies with an SDK-56-compatible version.

- [ ] **Step 2: Create the About screen**

Create `apps/mobile/src/screens/AboutScreen.jsx`:

```jsx
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Application from "expo-application";
import BackButton from "./BackButton.jsx";
import { palette, radius, space } from "../planner/theme.js";
import { aboutModel } from "./aboutModel.js";

export default function AboutScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const model = aboutModel({
    appVersion: Application.nativeApplicationVersion,
    buildNumber: Application.nativeBuildVersion,
  });

  return (
    <View style={styles.fill}>
      <BackButton onPress={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 68, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Text style={styles.title}>CycleWays</Text>
        <Text style={styles.version}>{model.versionLine}</Text>
        <Text style={styles.tagline}>תכנון וניווט מסלולי רכיבה בישראל</Text>

        <View style={styles.card}>
          {model.links.map((link, index) => (
            <Pressable
              key={link.key}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              onPress={() => Linking.openURL(link.url).catch(() => {})}
              style={({ pressed }) => [
                styles.linkRow,
                index > 0 ? styles.linkRowBorder : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.linkText}>{link.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>קרדיטים ומקורות נתונים</Text>
        {model.attribution.map((line) => (
          <Text key={line} style={styles.bodyText}>
            {line}
          </Text>
        ))}

        <Text style={styles.sectionTitle}>בטיחות</Text>
        <Text style={styles.bodyText}>{model.safetyNotice}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  scroll: { paddingHorizontal: 22 },
  title: {
    color: palette.ink,
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  version: {
    color: palette.muted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 4,
    writingDirection: "rtl",
  },
  tagline: {
    color: palette.muted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 2,
    marginBottom: space.lg,
    writingDirection: "rtl",
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    marginBottom: space.lg,
  },
  linkRow: {
    paddingVertical: 15,
    paddingHorizontal: space.lg,
  },
  linkRowBorder: {
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  linkText: {
    color: palette.forest,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: space.md,
    marginBottom: 6,
  },
  bodyText: {
    color: palette.muted,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 6,
  },
  pressed: { opacity: 0.7 },
});
```

- [ ] **Step 3: Register the screen**

In `apps/mobile/src/navigation/RootNavigator.jsx`:

Below the `BuildScreen` import, add:

```js
import AboutScreen from "../screens/AboutScreen.jsx";
```

Inside `<Stack.Navigator>`, after the `Build` screen element, add:

```jsx
<Stack.Screen name="About" component={AboutScreen} />
```

- [ ] **Step 4: Add the entry point on the Discover screen**

In `apps/mobile/src/screens/DiscoverScreen.jsx`, inside the `<ScrollView>`,
directly after the `<DiscoverPanel … />` element, add:

```jsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="אודות, פרטיות ותנאי שימוש"
  onPress={() => navigation.navigate("About")}
  style={({ pressed }) => [styles.aboutLink, pressed ? { opacity: 0.7 } : null]}
>
  <Text style={styles.aboutLinkText}>אודות CycleWays · פרטיות ותנאים</Text>
</Pressable>
```

In the same file's `StyleSheet.create({ … })`, after the `fabText` entry, add:

```js
aboutLink: {
  alignSelf: "center",
  marginTop: 8,
  paddingVertical: 10,
  paddingHorizontal: 16,
},
aboutLinkText: {
  color: palette.muted,
  fontSize: 13,
  textDecorationLine: "underline",
  writingDirection: "rtl",
},
```

- [ ] **Step 5: Verify**

Run: `node tests/test-about-model.mjs`
Expected: passes (screen reuses the tested model).

If an iOS simulator is available, also run `npm run mobile:ios` from the repo
root, tap the "אודות CycleWays · פרטיות ותנאים" link at the bottom of the
Discover screen, and confirm the About screen shows a version line, three
tappable links, attribution, and the safety text, with a working back button.
If no simulator is available, note that in the task report instead — do not
skip silently.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/AboutScreen.jsx apps/mobile/src/navigation/RootNavigator.jsx apps/mobile/src/screens/DiscoverScreen.jsx apps/mobile/package.json package-lock.json
git commit -m "feat: in-app About screen with version, legal links, and attribution"
```

---

### Task 8: iOS release compliance config — build number, encryption flag, Hebrew permission strings, Mapbox telemetry off

**Files:**
- Modify: `apps/mobile/app.json`
- Create: `apps/mobile/locales/he.json`
- Modify: `apps/mobile/src/screens/BuildScreen.jsx` (one line)
- Create: `tests/test-ios-release-config.mjs`
- Modify: `package.json` (root — test chain)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: release-config invariants enforced by
  `tests/test-ios-release-config.mjs`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-ios-release-config.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appJson = JSON.parse(
  await readFile(new URL("../apps/mobile/app.json", import.meta.url), "utf8"),
);
const ios = appJson.expo.ios;

// Build number must exist and be numeric so release uploads can bump it.
assert.match(ios.buildNumber, /^\d+$/);

// Standard-encryption-only declaration: skips the export-compliance prompt
// on every App Store Connect upload.
assert.equal(ios.infoPlist.ITSAppUsesNonExemptEncryption, false);

// Hebrew InfoPlist localization must be wired.
assert.equal(ios.infoPlist.CFBundleAllowMixedLocalizations, true);
assert.equal(appJson.expo.locales?.he, "./locales/he.json");

const usageKeys = [
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
];
for (const key of usageKeys) {
  assert.ok(
    typeof ios.infoPlist[key] === "string" && ios.infoPlist[key].length > 10,
    `base usage string ${key}`,
  );
}

const he = JSON.parse(
  await readFile(
    new URL("../apps/mobile/locales/he.json", import.meta.url),
    "utf8",
  ),
);
for (const key of usageKeys) {
  assert.ok(
    typeof he[key] === "string" && /[א-ת]/.test(he[key]),
    `Hebrew usage string ${key}`,
  );
}

// Mapbox telemetry must stay disabled: PrivacyInfo.xcprivacy and the App
// Store privacy labels declare no collected data.
const buildScreen = await readFile(
  new URL("../apps/mobile/src/screens/BuildScreen.jsx", import.meta.url),
  "utf8",
);
assert.ok(
  buildScreen.includes("setTelemetryEnabled(false)"),
  "Mapbox.setTelemetryEnabled(false) missing from BuildScreen.jsx",
);

console.log("test-ios-release-config: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-ios-release-config.mjs`
Expected: FAIL on the `buildNumber` assertion.

- [ ] **Step 3: Update app.json**

In `apps/mobile/app.json`:

1. Inside the `"ios"` object, directly after
   `"bundleIdentifier": "app.cycleways.mobile",` add:

```json
"buildNumber": "1",
```

2. Inside `"ios"."infoPlist"`, directly before
   `"NSLocationWhenInUseUsageDescription"`, add:

```json
"ITSAppUsesNonExemptEncryption": false,
"CFBundleAllowMixedLocalizations": true,
```

3. At the top level of the `"expo"` object, directly after
   `"userInterfaceStyle": "light",` add:

```json
"locales": {
  "he": "./locales/he.json"
},
```

Validate the file still parses:
`node -e "JSON.parse(require('fs').readFileSync('apps/mobile/app.json','utf8')); console.log('valid json')"`

- [ ] **Step 4: Create the Hebrew InfoPlist strings**

Create `apps/mobile/locales/he.json`:

```json
{
  "NSLocationWhenInUseUsageDescription": "המיקום משמש להצגתך על המפה בזמן תכנון רכיבה וניווט במסלול.",
  "NSLocationAlwaysAndWhenInUseUsageDescription": "הרשאת מיקום תמיד מאפשרת להמשיך את הנחיות הניווט גם כשהמסך נעול בזמן הרכיבה.",
  "NSMotionUsageDescription": "נתוני תנועה משפרים את דיוק המיקום והכיוון בזמן ניווט."
}
```

- [ ] **Step 5: Disable Mapbox telemetry**

In `apps/mobile/src/screens/BuildScreen.jsx`, find (around line 140):

```js
Mapbox.setAccessToken(MAPBOX_TOKEN);
```

and replace it with:

```js
Mapbox.setAccessToken(MAPBOX_TOKEN);
// Telemetry stays off: PrivacyInfo.xcprivacy and the App Store privacy labels
// declare that the app collects no data. Re-enabling requires updating both.
Mapbox.setTelemetryEnabled(false);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/test-ios-release-config.mjs`
Expected: prints `test-ios-release-config: ok`, exit code 0.

- [ ] **Step 7: Wire the test into the npm test chain**

In the root `package.json` `"test"` script, find
`&& node tests/test-about-model.mjs && cd tests &&` (added in Task 6) and
replace it with
`&& node tests/test-about-model.mjs && node tests/test-ios-release-config.mjs && cd tests &&`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/app.json apps/mobile/locales/he.json apps/mobile/src/screens/BuildScreen.jsx tests/test-ios-release-config.mjs package.json
git commit -m "feat: iOS release compliance config and Mapbox telemetry opt-out"
```

---

### Task 9: Ride safety notice in the ride setup sheet

**Files:**
- Modify: `apps/mobile/src/planner/RideSetupSheet.jsx`

**Interfaces:**
- Consumes: `palette` and `Icon`, both already imported by
  `RideSetupSheet.jsx`.
- Produces: nothing consumed later.

- [ ] **Step 1: Insert the safety note**

In `apps/mobile/src/planner/RideSetupSheet.jsx`, find the end of the
plan-summary block, which looks like this (the `farText` line, the closing of
the summary `View`, and the closing `</ScrollView>`):

```jsx
              {plan.approachTier === "far" ? (
                <Text style={styles.farText}>המסלול רחוק. מומלץ להגיע לנקודת ההתחלה בעזרת אפליקציית ניווט.</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
```

and replace it with:

```jsx
              {plan.approachTier === "far" ? (
                <Text style={styles.farText}>המסלול רחוק. מומלץ להגיע לנקודת ההתחלה בעזרת אפליקציית ניווט.</Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.safetyNote}>
            <Icon name="alert-circle-outline" color={palette.muted} size={17} />
            <Text style={styles.safetyNoteText}>
              ההנחיות הן עזר לתכנון בלבד. רכבו בזהירות וצייתו לתמרורים ולתנאי
              הדרך — הם קודמים לכל הנחיה מהאפליקציה.
            </Text>
          </View>
        </ScrollView>
```

- [ ] **Step 2: Add the styles**

In the same file's `StyleSheet.create({ … })`, add these two entries (after
the existing `farText` entry if present, otherwise at the end of the object):

```js
safetyNote: {
  flexDirection: "row-reverse",
  gap: 8,
  alignItems: "flex-start",
  marginTop: 14,
  paddingHorizontal: 4,
},
safetyNoteText: {
  flex: 1,
  color: palette.muted,
  fontSize: 12.5,
  lineHeight: 18,
  textAlign: "right",
  writingDirection: "rtl",
},
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: full suite passes (this catches accidental syntax breakage via the
suite's module imports; the sheet itself has no dedicated test).

If an iOS simulator is available, open a route, tap the start-ride flow, and
confirm the safety note appears at the bottom of the ride setup sheet, above
the start button. If not available, note it in the task report.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/RideSetupSheet.jsx
git commit -m "feat: safety notice in ride setup sheet"
```

---

### Final gate (after all tasks)

- [ ] Run `npm test` — everything passes.
- [ ] Run `npx playwright test tests/e2e/legal-pages.spec.mjs --workers=1`
      (both desktop and mobile projects) — everything passes.
- [ ] `git log --oneline` shows one commit per task with the messages above.
- [ ] `git status` is clean — in particular, nothing under `public-data/` is
      modified or staged.

---

## Appendix: Track 2 — Apple-side release work (NOT for the executing agent)

Owned by the repo owner, working with the assistant. Kept here as the
operational checklist; see `design.md` ("Work Split" and "External Apple
Systems To Prepare") for full context.

1. **Account and app record (do early — long lead times):** verify Apple
   Developer membership, publisher/legal entity, agreements, DSA trader status
   if distributing in the EU; create the App Store Connect app record for
   `app.cycleways.mobile` to reserve the name "CycleWays" (have fallback names
   ready).
2. **Signing and release lanes:** Apple Distribution certificate, App Store
   provisioning profile, Fastlane lanes for archive/export, TestFlight upload,
   and gated submit (the committed Fastfile has development lanes only);
   confirm Xcode 26 / iOS 26 SDK; Mapbox token injected from the release
   environment.
3. **Privacy labels and policy alignment:** audit runtime data flows (Mapbox
   with telemetry off, WebView/YouTube traffic, local static server), fill App
   Store privacy labels, confirm they match `/privacy` and
   `PrivacyInfo.xcprivacy`; answer export compliance (standard HTTPS only).
4. **Background-guidance validation (release gate):** physical rides on real
   routes with a Release build — locked-screen guidance, voice cues audible
   while locked (`UIBackgroundModes` declares only `location`), battery drain,
   When-In-Use → Always upgrade flow, mid-ride permission revocation.
5. **QA matrix and screenshots:** first launch, discover, route detail
   WebView, plan, deep-link restore, GPX share, external handoff, offline,
   location denied; accessibility (VoiceOver, Dynamic Type, contrast, RTL);
   iPhone + iPad screenshots (or drop `supportsTablet`) in Hebrew.
6. **TestFlight:** beta description, review notes, feedback email
   (`SUPPORT_EMAIL`), internal then external groups, crash/hang monitoring,
   iterate to a frozen release candidate.
7. **App Review submission:** review notes covering no-account usage, location
   rationale and the lock-screen toggle, the localhost server for bundled
   route content, network-dependent features, and a sample deep link; submit;
   respond to review; choose manual/phased release.
8. **Launch operations:** monitor crashes, reviews, support inbox, Mapbox
   token errors; keep a hotfix build path; keep policy and labels accurate.

### External Apple Checklist Summary

- Apple Developer Program membership active.
- Publisher/legal entity confirmed.
- Agreements accepted.
- Tax/banking complete if monetized.
- DSA trader status complete if distributing in the EU.
- Bundle ID `app.cycleways.mobile` created.
- App name reserved in App Store Connect.
- Capabilities reviewed and minimized.
- Distribution signing ready.
- App Store Connect API key ready.
- App Store app record created.
- App name/subtitle/category/age rating set.
- Privacy Policy URL (`https://www.cycleways.app/privacy`) and Support URL
  (`https://www.cycleways.app/support`) live.
- App privacy labels complete.
- Export compliance answered.
- Content rights confirmed.
- Screenshots uploaded for all supported devices.
- TestFlight beta info complete.
- Review notes written.
- Final build uploaded, processed, tested, and selected for review.
