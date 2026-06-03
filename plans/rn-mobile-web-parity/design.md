# React Native Mobile Web Parity Design

## Goal

Phase 2.8 realigns the iPhone app with the existing mobile web route planner.
The app should feel like the same CycleWays product: same route-planning
functionality, same Hebrew copy, same visual language, and the same underlying
controller state. The native app may adjust layout for iPhone ergonomics, but
it should not become a separate route-planning UI.

Status: in progress. The first implementation slice extracted shared route
presentation helpers and replaced the native proof overlay with a light Hebrew
planner chrome plus bottom route sheet.

## Context

Phases 2.4 through 2.7 proved the hard technical slices: shared
`useCyclewaysApp` runs in React Native, offline route shards load, native Mapbox
renders route geometry and route points, search can add points, and current
location can be followed. Those slices intentionally used a compact native
overlay to verify behavior quickly.

That overlay is now the wrong long-term design direction. It uses English copy,
new control grouping, and a dark status panel that does not match the mobile web
planner. Before adding navigation-mode complexity, the route-planning surface
should be brought back to mobile-web parity.

## Product Principles

- Same planner, native renderer: share route/search/controller behavior and
  diverge only at rendering and native-device integration boundaries.
- Prefer mobile-web parity over native novelty unless an iPhone-specific layout
  clearly improves usability.
- Keep the map as the primary screen.
- Remove website-only below-map content from the app.
- Use the same Hebrew user-facing route-planning copy wherever the web planner
  already has copy.
- Keep route-planning controls discoverable without crowding the map.

## Target Surface

The iPhone route-planning screen should include the mobile web planner's core
controls and states:

- search input with the web placeholder/copy and search affordance
- undo, redo, reset route
- route summary/share/download entry point when a route is available
- route status / description using the same messages as web
- route stats: points, CW segments, distance, elevation gain/loss
- selected waypoint chip/action state and remove point
- search error display
- broken-route and active-data warnings
- elevation summary/profile path where practical for the first parity pass
- native Locate control as an additive iPhone affordance, visually integrated
  with the same control language

## Native Layout Direction

The web mobile planner uses overlay controls plus a route-description panel. On
iPhone, the preferred equivalent is:

- top: compact search row, using the web styling language and Hebrew copy
- map: full-screen native Mapbox surface
- bottom: route planning sheet/panel for route description, stats, point chips,
  and secondary actions
- floating or sheet-adjacent icon controls: undo, redo, reset, locate, summary

The bottom sheet replaces website below-map content. It should support compact
and expanded states if needed, but the first implementation can start with a
fixed-height native panel that mirrors the web mobile route-description panel.

## Sharing Strategy

Keep `useCyclewaysApp` as the main shared state/handler boundary.

Move web-only route-planning presentation helpers into `@cycleways/core` when
they are pure and useful on both platforms:

- route messages from `getRouteMessage`
- distance/elevation formatting
- route-panel derived state such as `canDownload`, `hasBrokenRoute`, selected
  route point, and stats labels
- common control labels and accessibility labels where they are not DOM-specific

Do not try to share DOM components directly. The practical split remains:
shared controller/view-model semantics, separate DOM and React Native renderers.

## Non-Goals

- Implementing route-following/navigation mode.
- Rebuilding the full web home/discover/content sections in the app.
- Sharing CSS directly with React Native.
- Replacing RNMapbox or the native asset pipeline.
- Adding offline Mapbox tile-pack management.

## Acceptance Criteria

- At iPhone width, the native planner visually reads as the same product as the
  mobile web planner.
- Hebrew copy matches web planner copy unless a native-specific reason is
  documented.
- Route planning parity covers search, tap/search add, undo, redo, reset,
  selected waypoint removal, route status, route stats, and route summary entry.
- Existing simulator route-planning smoke still passes.
- Existing current-location Locate behavior remains available but no longer
  visually dominates the route-planning UI.
- Web behavior remains unchanged.
