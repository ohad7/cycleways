# Ways Workspace UX Redesign

**Date:** 2026-07-23
**Status:** Design A implemented 2026-07-23 (all three phases). Design B kept as
the recorded alternative; its chain proposal remains the natural next step.
**Related designs:** `navigation-way-names` (the data model and the CRUD
contract this UI must honor), `network-editor-workflow`, `editor-performance-ux`

## Why

The Ways workspace works, but it is organized around the *data model* — a
registry, a membership field, a suggestion artifact — rather than around the two
jobs a curator actually does. The result is a 430px column
(`editor/styles.css:41`) that stacks six independent tools, all visible at once:

| # | Block | Source |
|---|-------|--------|
| 1 | header + coverage counter | `editor/index.html:107` |
| 2 | way search + "דרך חדשה" | `editor/index.html:115` |
| 3 | flat way list | `editor/index.html:120` |
| 4 | "שיוך מקטע" — a second search, results, a way `<select>`, assign/unassign | `editor/index.html:122` |
| 5 | way editor form — id, name, kind, ref, spoken name, save/cancel/delete, members, issues | `editor/index.html:135` |
| 6 | suggestion review `<details open>` — a third search, a filter, refresh, cards | `editor/index.html:171` |

Concretely, what makes it feel cluttered:

1. **Three search boxes with three different scopes** (`ways-search`,
   `ways-segment-search`, `guidance-suggestion-search`). Nothing on screen says
   which list each one drives.
2. **Two ways to say the same thing.** The way `<select>` at
   `editor/index.html:128` is a worse duplicate of the way list at
   `editor/index.html:120`. Attaching a segment costs four widgets — type,
   click a result, read the confirmation line, pick from the select, press
   שיוך — to express "this piece belongs to that road", a fact already visible
   on the map.
3. **One map, two competing selections.** `waysHighlightedRecords()`
   (`editor/editor.js:1652`) shows *either* the suggestion preview *or* the
   selected way's members, never both, and with no visual difference between
   them. So the map cannot answer the question the curator is actually asking:
   *does this segment continue this way?*
4. **Rare fields crowd out the frequent task.** Way identity (stable id, kind,
   ref, spoken name, iOS-verification checkbox) is edited a handful of times per
   way. Membership is edited constantly — and it sits below the save row, at
   the bottom of the form.
5. **Facts are computed and then thrown away.** `reviewGuidanceDocuments`
   already produces `totalLengthMeters`, `componentCount`, `maxDegree`, and
   `endpointOnlyLinks` per way (`editor/lib/navigation-ways.mjs:176`). The list
   row shows `ref · kind · N מקטעים` (`editor/editor.js:11687`). The two most
   human facts — *how long is this road*, *is it in three disconnected pieces* —
   never reach the screen.
6. **Progress is a sentence, not a place.** `11/291 מקטעים מסווגים`
   (`editor/editor.js:11676`) is inert text. The work it refers to — the
   unreviewed segments — cannot be browsed at all; you can only reach segments
   that happen to appear in the suggestion artifact, which goes read-only
   whenever digests move (`editor/editor.js:11249`).
7. **Validation lives in three places**: coverage in the header, per-way issues
   at the bottom of the form, validator verdicts inside suggestion cards.
8. **Codes instead of language.** `guidanceIssueText` renders issue codes; a
   curator needs "שני חלקים מנותקים", not `way-structure-disconnected`.

Nothing here is a data-model problem. The transactions, the validator, and the
digest binding are sound and stay exactly as they are. This is a layout and
interaction problem.

## Design A — "תיבת סקירה + ספריית דרכים" (recommended)

**One question at a time, and the map does the assigning.**

The Ways panel stops being a stack of tools and becomes a small app with two
modes and one selection.

### A.1 Two modes, one search, one progress bar

The panel header collapses to three things:

```
┌ דרכים ושמות ניווט ─────────────────────────────┐
│  [ סקירה · 280 ]  [ דרכים · 8 ]        ⌕ חיפוש │
│  ▓▓▓░░░░░░░░░░░░░░░░░░  11/291 מסווגים  ⚠3 ⛔0 │
└────────────────────────────────────────────────┘
```

- **סקירה** is the burn-down queue: everything not yet classified.
- **דרכים** is the library: the registry you curate.
- **One search field** replaces all three. It searches ways *and* segments and
  returns typed rows (`דרך · כביש 99`, `מקטע · #162`). Picking a row decides
  what the panel shows — a way opens its detail, a segment opens its
  classification card. `/` focuses it.
- The **progress bar is clickable**: the bar filters the queue to unclassified,
  `⚠` to warnings, `⛔` to blockers. The number stops being a status line and
  becomes the way into the work.

Only one mode's content is on screen. That single change removes ~60% of the
panel's simultaneous controls.

### A.2 Library: way cards that say something

```
┌────────────────────────────────────────────────┐
│  כביש 99                              ● תקין   │
│  99 · כביש · 6 מקטעים · 8.4 ק״מ · רצף אחד      │
├────────────────────────────────────────────────┤
│  שביל אופניים יובלים                  ▲ אזהרה  │
│  שביל · 4 מקטעים · 3.1 ק״מ · שני חלקים מנותקים │
├────────────────────────────────────────────────┤
│  ＋ דרך חדשה מהמקטע הנבחר                      │
└────────────────────────────────────────────────┘
```

Every number here already exists in `wayReports`. The health dot comes from the
shared validator, and its label is written as a sentence, not a code. The stable
id moves off the row (it is machine identity, not human identity) and lives in
the detail's פרטים disclosure.

### A.3 Detail: identity collapses, members lead

```
┌ ← כל הדרכים                                ··· │
│  כביש 99  ✎                    [99] כביש  ● תקין│
│  6 מקטעים · 8.4 ק״מ · רצף אחד                  │
│  ▸ פרטים  (מזהה · סוג · מספר · שם להקראה)      │
├────────────────────────────────────────────────┤
│  מקטעים לפי הסדר                    [הצגה במפה]│
│  #124  מעיין ברוך              1.2 ק״מ      ⊖  │
│  #131  —                       0.6 ק״מ      ⊖  │
│  ⚠ חסר רצף כאן — פער של 240 מ׳                 │
│  #150  קרית שמונה              2.0 ק״מ      ⊖  │
├────────────────────────────────────────────────┤
│  מועמדים בקצוות · 3                            │
│  לחצו על מקטע מקווקו במפה כדי לצרף             │
│  ＋ #162 · ממשיך מצפון · 0.9 ק״מ               │
└────────────────────────────────────────────────┘
```

- The name is edited **in place** by clicking the title. Kind, ref, stable id,
  aliases, and spoken name live under **פרטים**, closed by default. The
  spoken-name field and its iOS-verification checkbox appear only when a spoken
  name exists or is being added — today that checkbox is always on screen
  (`editor/index.html:155`) for a field most ways never set.
- **Delete moves into the `···` overflow**, away from Save. Today
  `way-editor-delete` sits in the same action row as `way-editor-save`
  (`editor/index.html:163`).
- **Members are ordered along the way**, by walking the adjacency chain that
  validation already builds (`memberAdjacency`,
  `editor/lib/navigation-ways.mjs:210`), not by id. Gaps between components are
  rendered *in the list, in place*, as the sentence that explains the way's
  amber dot. That is the single most useful thing this panel can show: the
  shape of the road, top to bottom.
- Each row carries its `sectionLabel` inline-editable, which delivers the
  "list of section labels for quick consistency review" the parent design asks
  for without a separate screen.

### A.4 The map becomes the assignment surface

This is the change that deletes the whole "שיוך מקטע" block.

When a way is selected, the map paints three things at once instead of one:

| Layer | Look | Meaning |
|-------|------|---------|
| members | solid accent, end caps at each component end | this way |
| candidates | dashed accent ghost | active + unclassified + touching a member endpoint |
| taken | other way's color, muted, labeled | already belongs elsewhere |

- **Click a ghost → it joins the selected way.** One validated transaction (the
  existing `assignSelectedSegmentToGuidanceWay`), an undo in the status toast,
  the row appears in the members list.
- **Click a member → הסרה**, same guardrail as today (the last member cannot be
  removed; delete the way instead).
- Clicking a *taken* segment asks for confirmation before reassigning, exactly
  as the transaction already requires.

Candidates are derivable now: `memberAdjacency` already computes endpoint
adjacency with a 25 m tolerance, and `coverage.unreviewedSegmentIds` already
lists the unclassified set. Intersect them.

The mental model becomes "the road continues over there, and I say yes" —
one gesture, with the evidence in view — instead of a four-widget form.

### A.5 סקירה: an inbox, not a wall of cards

```
┌ סקירה                                   3 / 280│
│ ▓░░░░░░░░░░░░░░░░░░░░░░░░░░░                   │
│ [ הכול ]  [ אזהרות ]  [ ללא הצעה ]             │
├────────────────────────────────────────────────┤
│  #162 · מקטע לא מסווג                          │
│  הצעה: חלק מ״כביש 99״            ביטחון גבוה   │
│  למה: ממשיך מ־#150 · אותה מחלקת מתקן · שם זהה  │
│                                                │
│  ✓ אישור (Enter)   ✕ דחייה (⌫)   → דלג        │
│  ▸ שינוי לפני אישור                            │
└────────────────────────────────────────────────┘
```

- **One card at a time**, auto-fitted on the map with the target way drawn
  faintly behind it, so the decision is visual.
- **Keyboard-first**: Enter / ⌫ / →. Classification is a few hundred repeated
  decisions; it should feel like triaging mail.
- Name and kind editing folds under **שינוי לפני אישור** and auto-opens only
  when the validator flags something. Blocking issues keep their explicit
  acknowledgment checkbox — that guardrail is deliberate and stays.
- **The queue merges two sources**: suggestion groups *and* unreviewed segments
  with no suggestion. Today the second set is invisible; it is the majority.
  When the artifact goes stale, the queue shows one banner and a "צור הצעות
  מחדש" action, rather than silently disabling every accept button.

### A.6 One selection concept

Replace the either/or in `waysHighlightedRecords()` with a single focus object:

```js
state.guidance.focus = { type: "way" | "segment" | "suggestion", id }
```

Panel content and map layers both derive from it. Preview and selection stop
fighting for the same highlight.

### Delivery phases

Each phase is independently shippable and independently useful.

1. **Declutter** — mode switch, one search, stats + health sentence in rows,
   identity fields collapsed, delete into overflow, suggestions out of the
   `<details>` and into their own mode. Panel-local; no new data, no map work.
2. **Map assignment** — candidate ghosts, click-to-attach, undo toast. Delete
   the `#ways-segment-*` block; its transactions stay and are called from map
   clicks and member rows.
3. **Inbox** — merged work queue, ordered members with in-place gaps, keyboard
   triage, progress bar as filter.

## Design B — "צביעת מסדרון" (map-first alternative)

**A way is a corridor you paint, not a list you curate.**

The panel shrinks to a thin rail: the way list, a name field, and a health line.
Everything else happens on the map.

- Pick the **first** segment of a road, pick the **last**, and the editor
  proposes the unique contiguous chain between them by walking the same
  reviewed adjacency graph validation uses. The proposal is previewed as a
  highlighted corridor with a count and length; confirm applies it as one
  transaction.
- A **brush mode** lets you drag along the network to add or remove members
  continuously, with an inline count.
- A **way palette** — the eight registry ways as colored chips — lets you set
  the "active way", then click segments to paint them into it. Painting a taken
  segment recolors it after confirmation.
- Classification of *unnamed* and *standalone* segments is done with two more
  chips in the same palette, so the whole classification job is one tool.

**Where B wins:** long linear roads. A 40-segment highway becomes two clicks
instead of 40. It also matches how the network was authored in the first place,
and it is the interaction the parent design already anticipated
(`plans/navigation-way-names/design.md:1188`).

**Where B loses:** branchy ways with several components have no unique chain, so
the proposer falls back to per-segment work with no panel affordances left to do
it in. Identity editing (ref, spoken name, aliases) has nowhere natural to live.
Undo of a 40-segment paint is a bigger transaction than the current save path
expects. And it depends on the chain proposer, which does not exist yet — so
there is no useful phase 1.

## Recommendation

**Take A, in three phases.** It removes the clutter in phase 1 without touching
data, engine, or map code; it earns the map gesture in phase 2; and it converts
the coverage number into an actual workflow in phase 3. B's best idea — chain
proposal — is not lost: it drops into A.4 later as a modifier on the candidate
click (shift-click a distant candidate → propose the chain between here and
there), which is B's leverage without B's cost.

## What does not change

- The data model, the transactions, and the validator. Every action still goes
  through one validated save; the editor still reports exactly the issue codes
  Build reports.
- Digest binding and the read-only stale-artifact rule.
- The blocking-issue acknowledgment checkboxes (parallel-facility risk, iOS
  audible verification). They are deliberate friction on the two decisions that
  are expensive to get wrong.
- The Network tab's compact `הכוונה ושם דרך` section keeps its scope (role,
  way assignment, `sectionLabel`) and its link into Ways.

## Open questions

- **Library ordering** — resolved as built: the list stays sorted by name, and
  the `⚠`/`⛔` counters act as filters instead of a competing sort. Both counters
  exclude `segment-unreviewed`, which the coverage counter already owns.
- Should the review queue be ordered geographically (walk the network) rather
  than by confidence? Geographic order keeps the map still and makes consecutive
  decisions share context. Not built: the queue currently runs suggestion groups
  first, then unreviewed segments by id.
- The editor has no routing evidence, so a facility-class conflict can only be
  refused client-side for the `roadType: road` case; everything else is caught by
  the server on the round trip. That gap predates this work.

## As built

- `editor/lib/ways-workspace.mjs` owns the derivation (ordering, gaps,
  candidates, health/summary copy, unified search, merged queue) and is covered
  by `tests/test-ways-workspace.mjs`.
- Map layers: `ways-highlight-casing`, `ways-taken-layer`, `ways-candidate-layer`,
  `ways-member-layer`, `ways-preview-layer`, all fed by one `ways-context` source
  tagged per selection. The white casing exists because the accent alone reads as
  one more basemap road on the outdoors style.
- Keyboard: `/` search, `Enter` accept, `Backspace` reject, `←`/`→` move the
  queue, `Esc` back to the library — all inert while a field has focus.
- Clicking an unclassified segment on the map opens the review queue positioned
  at that segment, so no map click is a dead end.
