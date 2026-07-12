# App personas and experience fit — discussion summary

- **Date:** 2026-07-13
- **Status:** Discussion summary. No decisions locked; intended as the shared
  basis for concrete feature/UX proposals in a follow-up session.
- **Scope:** The iOS app (Discover → RouteDetail → Build/Navigate stack). The
  website and editor appear only where they feed the app's flows.

## Purpose

Map who uses the app, what they actually want, how well today's app serves
each of them, and where the highest-leverage gaps are. The end goal (next
session) is a set of concrete suggestions — especially shortcuts that collapse
a persona's long path into a short one.

## The personas

Each persona is described by trigger (what makes them open the app), the
motive underneath the stated objective, usage pattern, and what "done" means
to them.

### 1. Weekend ride picker
- **Trigger:** A free Saturday; browsing Wednesday–Friday evening, indoors,
  often with a partner.
- **Motive:** Avoiding a bad outing. They're buying *confidence* — the
  video/photos/warnings are the product.
- **Usage:** Low frequency (2–4×/month), long browsing sessions, compares 2–3
  candidates, often shares the winner. The ride happens days later.
- **Done:** A decision made and defensible.
- **Key insight:** The session is split in time and possibly across people —
  the planner and the rider may differ. The bridge between the browse session
  and the ride session matters more than either session alone.

### 2. At-the-trailhead rider
- **Trigger:** Physical presence at a route (sticker scan, friend's plan,
  repeat visit). Standing over the bike, group waiting.
- **Motive:** Don't hold everyone up. Trust is earned by the first two voice
  cues being correct.
- **Usage:** ~20–30 s tolerance for setup, then a 1–3 h passive session,
  phone mounted/pocketed.
- **Done:** Riding, with the app forgotten.
- **Key insight:** Tolerance for UI is inversely proportional to how many
  people are waiting. Every screen between scan and voice is a chance to give
  up and just follow the group.

### 3. DIY route builder
- **Trigger:** Ambition/curiosity ("can I link X to Y?"), training, or
  catalog dissatisfaction.
- **Motive:** Authorship and control; partly status as the group's
  route-maker.
- **Usage:** Long deliberate sessions, desktop-preferred, iterative. The phone
  enters late as the delivery device (`?route=` link).
- **Done:** A route they're proud of, saved/shared.
- **Key insight:** They are the content multipliers — every shared route
  recruits link-recipient users. Their output is other people's input.

### 4. Safety-first family rider
- **Trigger:** A child learning to ride, spring weather. Often not a
  "cyclist" in self-image.
- **Motive:** Fear management. The question is "where can nothing bad
  happen," not "what's a good route." One car encounter with a kid ends the
  relationship.
- **Usage:** Rare, seasonal, short sessions with a binary question. Won't
  learn a legend. Reuses the same 1–2 proven routes forever.
- **Done:** A yes/no answer they trust.
- **Key insight:** Lowest frequency but high word-of-mouth value in parent
  circles. Looks like persona 1 in the UI, but their filter is
  safety-absolute, not scenery-relative.

### 5. Tourist / visitor
- **Trigger:** Trip planning or on-site opportunity (rental shop, sticker,
  hotel tip).
- **Motive:** Experience collection — the local's pick without the local.
  Zero interest in the tool.
- **Usage:** 1–3 sessions total, ever. Install–use–delete. No learning curve,
  no account.
- **Done:** A memorable ride and photos.
- **Key insight:** Overlaps persona 2's flow with even less context (region,
  app, possibly language). Whatever works for them works for everyone.
  Split: domestic tourist (well served) vs foreign visitor (blocked —
  Hebrew-only, no i18n layer anywhere; a strategy question, not a UX bug).

### 6. Link recipient
- **Trigger:** Entirely external — a WhatsApp message. The route chose them.
- **Motive:** Social compliance and reassurance ("what did I agree to? can I
  handle it?"). Evaluates difficulty relative to self.
- **Usage:** Reactive single-purpose sessions: ~60 s inspection, then maybe
  the ride (where they become persona 2). Some convert to persona 1.
- **Done:** Knowing what to expect, and showing up.
- **Key insight:** This is the app's main organic-acquisition funnel
  (3 builds → 1 picks → both share → 6 receives). Their first impression is
  the app's first impression — and today it's the Build editor.

### 7. Mid-ride rider (a state, not a person)
- **Trigger:** Something went wrong mid-ride: missed turn, group split,
  shortcut home.
- **Motive:** Recovering competence — being lost is stressful and slightly
  embarrassing.
- **Usage:** Urgent 10-second interactions, one-handed, glare and gloves.
- **Done:** Back on route, phone away.
- **Key insight:** Where trust is won or lost permanently. Recent investment
  (off-route rejoin, wrong-way, mid-route join, crash resume, lock-screen
  voice) defends every other persona's retention.

### 8. Commuter — deliberate non-persona (open decision)
Daily A→B destination routing is a different product shape; the app has no
"navigate to a destination" flow. Highest-frequency users a cycling app can
have, but explicitly undecided whether in scope.

### Structural reading
These aren't seven markets — they're roles in one lifecycle. Builders (3) and
pickers (1) create and select; sharing turns recipients (6) and trailhead
riders (2) into riders; rescue moments (7) decide who returns. Tourists (5)
and family riders (4) are the two genuinely separate segments with their own
entry points (stickers/search; word-of-mouth).

The app currently has one "shape" — the planner — but only persona 3 thinks
in planner terms. Everyone else arrives with a narrower question ("where near
me," "is it safe," "just guide me") and gets a general-purpose surface.

## Experience review (verified against the code, 2026-07-13)

Flow facts checked during the review:

- Launch targeting (`apps/mobile/src/navigation/launchTarget.js`): catalog
  slug → RouteDetail; shared `?route=` token → **Build (the editor)**;
  everything else → Discover.
- RouteDetail is the rich mobile-web page in a WebView
  (`RouteDetailScreen.jsx`) and **does** expose a navigate CTA
  (`onNavigate` → Build with `openRideSetup: true`), plus open-editor and
  GPX download. (`RouteDetailNative.jsx` exists with a single
  "פתח לעריכה" CTA but is not the screen in the navigator.)
- Discover already has place filters, difficulty/surface/distance chips,
  near-me sort, and search (`DiscoverPanel.jsx`).
- `data/sticker-redirects.json` has an empty `redirects` map — sticker scans
  currently point at nothing specific.
- No saved/my-routes/recents surface exists in the app.

| Persona | Grade | Root cause of friction |
|---|---|---|
| Mid-ride rider | ★★★★ | — (recent investment landed here) |
| Weekend picker | ★★★★ | no shortlist / no "save for Saturday"; WebView load per candidate; comparison is memory-based |
| Domestic tourist | ★★★½ | same as picker + trailhead |
| Trailhead rider | ★★★ | cold start is 5–6 interactions + two waits (WebView, GPS fix); stickers unwired; no "ride again" |
| DIY builder | ★★★ | touch precision (see `mobile-map-gesture-intent`); authored work has no home; desktop→phone hand-off works but is undiscoverable |
| Link recipient | ★★½ | `?route=` lands in the editor — a reading task on an editing surface; description/photos/warnings unreachable (tokens have no slug) |
| Family rider | ★★ | safety never framed as an answer; "difficulty: easy" ≠ "safe with a 6-year-old"; largest gap between data the app has and experience it delivers |
| Foreign tourist | ★★ | Hebrew-only; a wall, not friction |

**Pattern:** strongest where the user is already committed (riding, rescuing,
browsing with intent); weakest at *arrival moments* — arriving with a fear
(4), with someone else's plan (6), with a waiting group (2).

## Catalog reality: 8 routes, one region

All eight catalog routes are in the Upper Galilee / Hula Valley / Golan
foothills, forming a complete distance ladder:

- Family loops: Sovev She'ar Yashuv 5.8 km, Sovev Beit Hillel 6.5, Sovev
  Dafna 7
- Half-day: Kovshey HaGolan 12.5, Banias–Gan HaTzafon 14.8
- Serious: HaYarden HaHistori 23.7, Roman Roads 26.8
- Epic: Naftali–Dishon–Yesha 53.8

Consequences:

- **Nationally a shortage, regionally a guidebook.** A Tel Aviv picker's
  "near me" returns a route 180 km away — a one-session relationship no UX
  fixes. Someone in (or planning a trip to) the panhandle finds a complete
  regional guide.
- **The domestic tourist is the best-fit persona today**, not a marginal one.
  The national weekend picker is a *future* persona gated on catalog growth.
- **The family gap is labeling, not inventory** — three flat kibbutz loops
  under 7 km exist; nothing presents them as "safe with kids."
- **The UI oversignals depth**: search/chips/result-count are big-catalog
  affordances; over 8 items they mostly manufacture empty states. A front
  page that owns the regional story would read as curated rather than sparse.
- Supply growth is bounded by the editor pipeline; the only non-curation
  route source is DIY builders' shared routes (vetted-vs-community question
  attached).

**Open strategic fork:** near-term identity — (a) the definitive riding guide
for one region, then the next region, vs (b) a national app still filling in.
The personas to optimize for, and the shortcuts worth building, differ
between them. Undecided.

## Usage-frequency analysis: which paths dominate

Caveat: inference from comparable products (Komoot saved Tours, Strava
routes, Waze home/work), not our data — user base is too small to measure yet.

A retained user discovers a route once, decides once, and **rides it many
times**. Projected histogram:

1. **Repeat-ride start** ("open app → *my* route → ride") — the
   most-executed path of a retained user's life. **Currently doesn't exist**;
   every ride requires re-finding the route through the catalog.
2. **Mid-ride ambient use** — hours per session, passive. Well served.
3. **Pre-ride re-check** — served, but through the same re-finding problem.
4. **Discovery browsing** — front-loaded into first sessions, then rare. It
   is the app's least frequent activity — and its launch screen.
5. **Building** — rarest.

**Structural finding:** the front door is optimized for the first session;
nothing is optimized for the hundredth. Content expands path 4; "my routes"
creates path 1; path 1 is the bigger number.

## "My routes" — the missing hub (agreed: fundamental)

The poorly-graded personas all lack the same primitive: the app has no memory
of the user's relationship to routes. One local-storage feature (no accounts;
the `?route=` token is already the universal currency) repairs four personas:

- Weekend picker → save from the detail page ("save for Saturday").
- Link recipient → received routes land in my routes instead of evaporating.
- DIY builder → drafts and authored routes get a home.
- Trailhead repeat rider → "ride again" at the top.

Compounding follow-on: once my-routes exists, the **home screen can adapt** —
returning users open to "your routes / ride again" (most-frequent path drops
from ~6 interactions to ~2); new users open to Discover.

## Ranked non-content gaps (beyond my-routes)

1. **Sticker wiring** — `sticker-redirects.json` is empty; the physical
   funnel points at nothing. Cheap; feeds scan → ride.
2. **Link-recipient landing** — a read-only "route received" view (Ride /
   Save) instead of dropping novices into Build. Small routing change;
   protects the growth funnel.
3. **Family labeling** — a "מתאים למשפחות" badge on the three sovev loops.
   ~An hour of editorial framing; unlocks a persona.
4. **Trailhead cold-start compression** — largely falls out of my-routes +
   sticker wiring for repeat/scanned rides; the remaining first-time case is
   harder and deferred.

## Instrumentation before further prioritization

Before investing beyond my-routes, add a minimal screen-transition event log
(~a dozen named events: launch target, detail opened, ride-setup confirmed,
nav completed, …) alongside the existing `navigationTelemetry`, so the next
prioritization argument is TestFlight data instead of analogy. My-routes
itself doesn't wait for data — the reasoning is structural (repeat use needs
memory; the app has none), the cost is low, and comparable products converged
on it.

## Open questions for the next session

1. Regional-guide vs national-app identity (drives persona priority and
   Discover's framing).
2. Is the commuter ever in scope?
3. Is the foreign tourist in scope (i18n is expensive)?
4. Community routes from DIY builders: allowed into any shared surface, and
   how separated from the vetted catalog?
5. Concrete design for my-routes (sections: saved / recents / received /
   drafts? one list? ride-again affordance?), the adaptive home screen, the
   sticker → ride flow, and the link-recipient landing.
