# React Native Location Design

## Goal

Phase 2.7 starts the native GPS/navigation path by showing the rider's current
location on the iPhone map and adding a compact control that can center/follow
that location.

Status: implemented and simulator-verified on 2026-05-30.

## Scope

- Add the iOS when-in-use location permission copy to the Expo app config.
- Render Mapbox's native location puck on `MapScreen`.
- Track native location updates locally in the screen.
- Add a compact Locate/Stop control to the existing overlay.
- Use the native `Camera` follow mode for current-location tracking.

## Non-Goals

- Turn-by-turn navigation.
- Background location.
- GPX recording or live ride statistics.
- Offline tile-pack changes.
- Web UI changes.

## Design Notes

This stays in the native renderer because current location is a device concern,
not shared route-controller state. The shared `useCyclewaysApp` hook remains
responsible for planning, search, route geometry, route history, and shard
prefetching.

The first version intentionally avoids a new navigation mode. The Locate control
requests/uses the native Mapbox location provider, enables camera following, and
can be toggled back off. Future navigation work can promote the same location
state into a richer ride-following surface.
