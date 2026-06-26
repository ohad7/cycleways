# Route Network Visual Emphasis - Design

**Date:** 2026-06-25.

## Goal

Explore stronger route-network rendering, especially while manually building a
route, without losing the current semantic segment-type colors. The work should
support several feature-flagged visual options so we can compare them against a
SchweizMobil-style reference before choosing a default.

## Current State

- `packages/core/src/domain/routeNetwork.js` classifies network features into
  three visual buckets and bakes `routeColor`, `routeWidth`, and `routeOpacity`
  into each GeoJSON feature.
- `packages/core/src/map/mapStyles.js` renders the network as one 3px line,
  plus invisible hit, hover, and focus layers. The active built route is a 5px
  blue line.
- `src/map/mapLayers.product.js` adds the visible network layer, hit layer,
  hover layer, and focus layer. It does not currently add a casing/halo layer
  under the network.
- The native app also consumes `prepareRouteNetworkFeatures`, so changes to the
  baked feature properties naturally affect web and native. Additional web-only
  layers, such as a casing layer, need explicit native parity work.

## Reference Observations

SchweizMobil's Veloland map achieves prominence through several combined
choices:

- saturated route color over a detailed base map;
- thick rounded strokes with a visible contrast edge/casing;
- route-number shields above the line;
- scale-aware stroke widths, so the network stays readable at broad scales
  without overwhelming local map detail when zoomed in.

The takeaway for CycleWays is not "make everything blue". It is: make route
geometry the dominant product layer while preserving enough map context and
segment semantics for planning decisions.

## Design Principles

- Preserve segment-type meaning. A single-color benchmark is useful for
  comparison, but the likely product direction should keep typed colors.
- Make prominence zoom-aware. A fixed stroke width will either feel too weak at
  overview zooms or too heavy at detailed zooms.
- Separate "available network" from "my route". While building, the selected
  route should be unmistakable even when it runs over the same network colors.
- Prefer explicit style profiles over live tile sampling. Mapbox tile pixels are
  not stable input data; a base-map profile is easier to test and reason about.
- Keep the experiment reversible. Every option should be controlled by a flag or
  variant value, with `current` preserving today's behavior.

## Feature Flag Model

The existing feature flag helper is boolean-only. This experiment needs a string
variant:

```js
routeNetworkPresentation: "current" | "typed-bold" | "typed-cased" | "build-focus" | "single-blue"
```

Read order should match existing flags:

1. Query params such as `?networkStyle=typed-cased`.
2. `window.CYCLEWAYS_FEATURE_FLAGS.routeNetworkPresentation`
3. default Build-mode experiment values:
   `networkStyle=typed-cased`, `routeStyle=dark`,
   `networkScheme=outdoors-balanced`,
   `baseMapProfile=mapbox-outdoors`

Query-param aliases:

- `networkStyle` -> `routeNetworkPresentation`
- `routeStyle` -> `routeGeometryPresentation`
- `networkScheme` -> `routeNetworkColorScheme`
- `baseMapProfile` -> `routeNetworkBaseMapProfile`

The map should receive an explicit prop, for example
`networkPresentationVariant`, rather than having layer code read globals
directly. That keeps tests deterministic and leaves React Native able to opt in
through the same controller state later.

For the temporary comparison phase, a map overlay exposes one slider per
parameter and writes query params directly. This replaces localStorage control
so the active option is visible in the URL and easy to share.

## Segment Color Scheme

Current buckets:

- primary cycleway-style segments: muted teal;
- road / shared-road-like segments: gray;
- fallback / dirt-or-trail-like segments: brown.

The experiment should keep these buckets but move from one hardcoded palette to
a named color-scheme object:

```js
{
  id: "outdoors-balanced",
  colors: {
    primary: "#1976c9",
    road: "#6f7782",
    trail: "#a06a32",
  },
  casing: "rgba(255, 255, 255, 0.86)",
  shadow: "rgba(26, 44, 63, 0.24)",
}
```

Color-scheme candidates:

- `current-muted`: existing colors, for baseline.
- `outdoors-balanced`: stronger typed colors tuned for Mapbox Outdoors green /
  cream terrain.
- `topo-high-contrast`: SchweizMobil-style blue emphasis, but with typed
  alternates for road/trail.
- `gray-map-saturated`: higher saturation and darker casing for a grayscale or
  low-color base map.
- `aerial-bright`: bright cores with darker casing for satellite imagery, if a
  future aerial base layer is added.

Adaptive behavior should be profile-driven:

```js
networkColorScheme = colorSchemeForBaseMap(baseMapProfile, variant)
```

For now `baseMapProfile` can be `"mapbox-outdoors"`. If we add base-map
switching later, each base map can choose a profile without changing the
network-layer implementation.

## Visual Options

### Option A: `current`

No visual change. This is the control group and must remain the default until a
variant is selected.

### Option B: `typed-bold`

Keep one visible line layer, but use stronger typed colors and zoom-aware width:

```js
["interpolate", ["linear"], ["zoom"], 8, 3.2, 11, 4.2, 14, 5.6]
```

Pros: small diff, shared with native through baked feature properties or shared
style helpers. Cons: lacks the casing that gives SchweizMobil its strongest
contrast.

### Option C: `typed-cased`

Add a casing layer below the typed network core. The casing is slightly wider,
light or dark depending on the base-map profile, and the core keeps typed
colors.

Pros: closest to the reference while preserving segment meaning. Cons: needs
another layer on web and a matching native layer later.

### Option D: `build-focus`

Use a softer network in neutral browsing/discovery states, then switch to a
more pronounced cased network while the user is actively building or editing a
route (`routePointCount > 0`, pending point, or drag preview).

Pros: targets the manual-route-building problem directly. Cons: visual style
changes during interaction, so transitions must be subtle enough not to feel
jumpy.

### Option E: Active Route Casing

Independent of the network variant, render the built route as a cased line:
contrast casing under a saturated route core. This can coexist with typed
network colors and is the clearest way to distinguish "my selected route" from
"available segments".

Pros: improves route-building clarity even if the base network remains typed and
moderate. Cons: does not solve the visibility of unselected network segments by
itself.

### Option F: `single-blue`

Render the full network in a SchweizMobil-like blue with casing.

Pros: useful benchmark for maximum prominence. Cons: drops typed segment-color
meaning, so it is unlikely to be the final product default unless planning
clarity improves dramatically.

## Recommended Experiment Set

Build the comparison around four variants:

1. `current` - control.
2. `typed-bold` - simplest improvement.
3. `typed-cased` - likely best balance of prominence and semantics.
4. `build-focus` - likely best for manual route-building if always-bold feels
   too loud.

Treat `single-blue` as an optional benchmark, not a likely default.

Also test active-route styling as an orthogonal control:

```js
routeGeometryPresentation:
  | "current"
  | "cased"
  | "bright-blue"
  | "orange"
  | "dark"
  | "magenta"
```

That lets us answer two separate questions:

- How pronounced should the available network be?
- How pronounced should the built route be?

## Open Questions

- Should the network become more prominent only after the user enters Build, or
  should the map always advertise the network strongly?
- Are typed segment colors still recognizable once casing and zoom-aware widths
  are added?
- Do we need route-number/segment-type labels later, or are line colors and the
  road-type legend enough?
- Should Discover route overlays suppress the pronounced network while previewed
  to avoid too many competing route lines?
