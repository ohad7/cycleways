# My Routes — design

- **Date:** 2026-07-13
- **Status:** Design draft for review. UX designed first; UI kept at
  wireframe level on purpose. Follows from `plans/app-personas/design.md`,
  which identified the app's lack of route memory as its single most
  important gap.
- **Decisions locked with Ohad (2026-07-13):** hybrid memory model
  (auto-recents + optional pin), home shelf + full management screen,
  tap-views / ▶︎-rides card interaction. Everything else below is a
  proposed default, open to review.

## 1. Problem and goals

The app has no memory of the user's relationship to routes. Every ride —
including the tenth ride of the same route — starts by re-finding the route
through the catalog. Four personas pay for this (see `app-personas`):

- The **weekend picker** decides on Wednesday and has nowhere to put the
  decision for Saturday.
- The **link recipient**'s route lives in a WhatsApp thread; the app forgets
  it on leaving Build.
- The **DIY builder**'s authored work has no home (and on iOS today, drafts
  don't even survive an app restart — see §6.1).
- The **trailhead repeat rider** has no "ride again."

**Goal:** the repeat-ride path — open app → my route → riding — drops from
~6 interactions plus a catalog search to 2 taps, and every meaningful route
encounter (rode, received, built, chose) is retained without user effort.

**Non-goals (v1):** accounts, cross-device sync, ride statistics/history as
a feature (we keep only per-route `lastRiddenAt`/`rideCount` metadata),
social features, collections/folders.

## 2. UX design

### 2.1 Mental model

> "The app remembers the routes that matter to me. If I want to make sure
> one stays around, I pin it."

Two shelves, one list:

- **Saved (pinned)** — routes the user explicitly kept. Never age away.
- **Recent** — routes the app remembered on its own because something
  meaningful happened (rode it, received it, built it). Age away when the
  list is full.

The user never *has* to manage anything. Pinning is an optimization, not a
requirement — Yael, who never taps "save," still gets "ride again" for
Sovev Dafna because she rode it.

### 2.2 What earns memory (capture rules)

| Event | Captured? | Source tag | Notes |
|---|---|---|---|
| Ride started (nav session begins) | Yes | `ridden` | Sets `lastRiddenAt`, increments `rideCount`. Counted at start, not arrival — an aborted ride is still "I rode this." |
| Shared `?route=` link opened | Yes | `received` | Captured at launch-target time, before the user even interacts. |
| Route built in Build (≥ 2 points, route computed) | Yes | `built` | Exactly one live draft at a time (matches today's draft model); a draft entry updates in place until "finished" (ridden/shared/renamed), then behaves like any entry. |
| Explicit save (pin) from route detail / Build / shelf | Yes | keeps existing source, sets `pinned` | The weekend picker's "save for Saturday." |
| Browsing a catalog route detail | **No** | — | Browsing is not commitment. This is what keeps Recent meaningful. The detail page offers the explicit save affordance instead. |

Rationale for the browse exclusion: with an 8-route catalog a curious user
opens most of it in one session; auto-capturing views would make Recent a
mirror of the catalog and bury the ridden route (the failure mode of the
"fully automatic" model we rejected).

### 2.3 Surfaces

**A. Home shelf (Discover, above the catalog).**
- Appears only when at least one entry exists. **New users see today's
  home unchanged** — zero regression for the first-session experience.
- Shows the top 2–3 entries: pinned first, then by most recent meaningful
  interaction (`max(lastRiddenAt, lastOpenedAt, updatedAt)`).
- Header: "המסלולים שלי" with "הצג הכל ›" when more entries exist.
- The active draft, when present, appears as a distinct resume card
  ("המשיכו בטיוטה") on the shelf — this **absorbs** the current
  BuildEmptyActions draft-restore offer as the primary restore path (the
  in-Build offer can remain as a secondary).

**B. Card interaction (the core of the repeat-ride path).**
- **Tap card → route view** (safe, informative default — the couch user
  checking "how long was it?" never gets a GPS-seeking ride sheet).
  Catalog-backed entries open RouteDetail (slug); token-only entries open
  Build (the editor — the only token-viewing surface today; the planned
  read-only landing from `app-personas` replaces this target when it
  ships, see open question 3).
- **Tap ▶︎ → ride setup directly**, prefilled with last-used settings
  (direction, start choice) stored on the entry. Reuses the existing
  `openRideSetup: true` Build param path. GPS fix starts immediately.
- Card content: name, distance, one relationship line ("נרכב לפני שבוע" /
  "התקבל מקישור" / "טיוטה"), thumbnail if available (catalog routes have
  them; token routes fall back to a mini route-shape glyph).

**C. My Routes screen (management).**
- Reached via "הצג הכל" from the shelf. Full list: Saved section, then
  Recent.
- Per-entry actions: pin/unpin, rename, delete, share, ▶︎ ride.
- This is where management clutter lives so the shelf never has to.

**D. Capture affordances elsewhere.**
- Route detail page: a save/pin action (bookmark icon) — the picker's
  "save for Saturday."
- Build: "שמרו את המסלול" action once a route exists (pins the built
  route and prompts for a name, replacing the anonymous-draft state).

### 2.4 Persona walkthroughs (before → after)

- **Trailhead repeat rider:** open app → shelf → ▶︎ on Sovev Dafna → confirm
  ride setup. **2–3 taps** (was: Discover → search/scroll → detail
  (WebView load) → נווט → setup → confirm, ~6 interactions + 2 waits).
- **Weekend picker:** Wednesday: detail page → bookmark. Saturday: open app
  → shelf → ▶︎. The decision survives the week.
- **Link recipient:** taps the WhatsApp link once; even if they close the
  app immediately, "מסלול מנועה" (see naming, §2.5) is on the shelf when
  they arrive at the ride. The route stops living in the chat thread.
- **DIY builder:** the half-built route from Tuesday is a resume card on
  Thursday's home screen — on iOS today it would have been silently lost
  on the first app restart.

### 2.5 Naming

- **Catalog entries** use their catalog name (and keep slug linkage for
  detail-page opens and thumbnails).
- **Token entries** get an auto-name, locally derived, no network:
  nearest place to the route start from the bundled places dataset +
  distance — "מסלול ליד בית הלל · 12 ק״מ". Received routes prefix
  "מסלול שהתקבל" when no better context exists.
- Rename is available in the My Routes screen; a user-set name is never
  overwritten by auto-naming.

### 2.6 Ordering, aging, limits

- Order: pinned (by pin time, newest first), then recent (by last
  meaningful interaction).
- Recent is capped (proposed: 15 entries). Eviction: oldest interaction
  first, except entries with `rideCount > 0`, which are evicted last —
  a route you actually rode outlives a link you glanced at.
- Pinned entries are exempt from eviction and (proposed) uncapped; if a
  practical cap is wanted, 50 with an "unpin something" prompt.

### 2.7 Edge cases

- **Stale tokens after map-data updates:** tokens encode shard-aware route
  geometry; a promote can invalidate old tokens. On open failure, the entry
  shows an inline "המסלול כבר לא זמין" state with delete — never a silent
  disappearance or a crash. (Catalog entries re-resolve via slug and are
  immune.)
- **Removed catalog routes:** fall back to the stored token; if that also
  fails, same stale state.
- **Same route, multiple identities:** an entry is keyed by slug when it
  has one, else by token. Riding a catalog route updates the slug entry;
  receiving a token that matches a known slug (if detectable cheaply) may
  merge, but v1 tolerates the occasional duplicate rather than building
  route-identity resolution.
- **Draft vs. saved built route:** one live draft, updated in place.
  Explicitly saving it (name prompt) converts it to a pinned `built`
  entry and clears the draft slot.

## 3. UI direction (deliberately thin — after UX)

Wireframe-level only; visual design follows the existing planner theme
(`planner/theme.js`, typography tokens) and the Discover card language:

```
Discover (returning user)                My Routes screen
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ המסלולים שלי        הצג הכל › │    │ ‹  המסלולים שלי               │
│ ┌─────────┐ ┌─────────┐      │    │ שמורים                        │
│ │[thumb]  │ │[thumb]  │  →   │    │  📌 סובב דפנה      7 ק״מ  ▶︎ │
│ │סובב דפנה│ │טיוטה    │      │    │ אחרונים                       │
│ │7 ק״מ ▶︎ │ │המשיכו › │      │    │  מסלול מנועה     12 ק״מ  ▶︎ │
│ └─────────┘ └─────────┘      │    │  טיוטה · ליד דפנה   המשיכו › │
│ מסלולים מומלצים               │    │  (swipe: הסרה · שינוי שם)     │
│ …catalog as today…           │    └──────────────────────────────┘
└──────────────────────────────┘
```

- Shelf cards are horizontal-scroll, same corner radius/shadow family as
  Discover catalog cards, visibly smaller so the catalog remains the
  visual anchor of the home (supports the regional-guide story).
- RTL throughout, as the rest of the app.
- Accessibility labels on card and ▶︎ separately (Maestro smoke tests
  target accessibilityLabel).

## 4. Data & architecture

### 4.1 Store (in `@cycleways/core`, platform-agnostic)

New module, e.g. `packages/core/src/myRoutes/` — pure logic (capture,
ordering, eviction, auto-naming, schema migration) injected with a storage
adapter and a clock, matching the codebase's core-with-adapters pattern.

Entry schema (v1):

```json
{
  "id": "slug:sovev-dafna | token:<route-token>",
  "slug": "sovev-dafna | null",
  "token": "<?route= token — always present; the universal currency>",
  "name": "string", "autoNamed": true,
  "source": "ridden | received | built | saved",
  "pinned": false,
  "createdAt": 0, "lastOpenedAt": 0,
  "lastRiddenAt": 0, "rideCount": 0,
  "lastRideSetup": { "direction": "forward", "start": "nearest" },
  "draft": false,
  "stats": { "distanceKm": 7 }
}
```

Document: `{ schemaVersion: 1, entries: [...] }`.

### 4.2 Persistence

- **Native:** a dedicated JSON file via `expo-file-system`
  (`my-routes.json` in `documentDirectory`), same proven pattern as
  `activeNavigationStore.js`. Debounced writes; read once at launch.
- **Web (parity later):** localStorage through the existing
  `platform/storage.js`. The core store doesn't know the difference.
- Explicitly **not** building on `storage.native.js` as-is — it's an
  in-memory Map (§6.1). Whether to also make that adapter file-backed is a
  separate small fix this feature makes urgent for drafts.

### 4.3 Capture hooks (all thin calls into the core store)

- `launchTarget` / Build-with-token entry → `captureReceived(token)`.
- Navigation session start (`useNavigationSession` / lifecycle) →
  `captureRideStart(routeRef, rideSetup)`.
- Build route-changed (≥ 2 points, debounced) → `captureDraft(token)` —
  replaces the session-only draft mechanism as the source of truth.
- Detail-page bookmark / Build save → `pin(entryRef, name?)`.

### 4.4 Ride-again path

Shelf ▶︎ → `navigate("Build", { routeToken, slug, openRideSetup: true,
rideSetupSelection: entry.lastRideSetup })` — the params already exist
(`BuildScreen.jsx` reads `openRideSetup` and `rideSetupSelection`); the
only new piece is prefilling from the stored entry.

## 5. Testing

Follows the repo's node-test pattern (`tests/test-*.mjs`) — the core store
is pure and clock-injected, so all of this is deterministic:

- Capture rules: each event type creates/updates the right entry; browsing
  creates nothing.
- Ordering and eviction: pinned exemption, ridden-outlives-glanced,
  cap behavior.
- Auto-naming from a places fixture; user rename never overwritten.
- Schema migration (v1 → future) round-trip.
- Stale-token entry state.
- Shelf view-model (top-N selection, draft card inclusion) as a pure
  presentation function, mirroring how nav presentation is tested.

On-device: extend the Maestro smoke to ride a route (simulated), relaunch,
and assert the shelf shows it.

## 6. Repairs this feature forces (in scope)

1. **`storage.native.js` is an in-memory Map** — the existing Build
   draft-restore silently doesn't survive an app restart on iOS. My-routes
   supersedes it for drafts; the adapter itself should still be made
   file-backed (or documented as session-only) so nothing else quietly
   depends on phantom persistence.

## 7. Open questions

1. Should completing a ride (arrival) be reflected on the card ("הושלם")
   distinctly from started rides? (v1 default: no — one `rideCount`.)
2. Shelf size: 2 vs 3 cards before "הצג הכל" (default: up to 3, fewer if
   a draft card is present).
3. Does the link-recipient read-only landing (separate `app-personas` gap)
   ship together with this — the received route's "view" target — or
   after? Default: after; token entries open Build view for now.
4. Web parity timing: the store is core-ready for web, but the web home
   is a different surface; explicitly deferred.

## 8. Sequencing sketch (for the implementation plan)

1. Core store + tests (pure logic, schema, eviction, naming).
2. Native persistence adapter + capture hooks (invisible — data starts
   accumulating; verifiable via dev telemetry).
3. My Routes screen (list, pin/rename/delete, ▶︎).
4. Home shelf + draft resume card (the visible payoff).
5. Detail-page bookmark + Build save affordances.
6. Maestro smoke extension.
