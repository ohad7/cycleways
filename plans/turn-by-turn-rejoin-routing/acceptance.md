# Turn-by-Turn Rejoin Routing Acceptance

**Date:** 2026-06-29
**Status:** automated validation complete; iOS export and device acceptance pending

## Automated validation

- [x] Full `npm test` suite passes, including connector targeting, non-mutating
  route preview/coverage loading, session lifecycle, replay, handoff, retries,
  pause/stop, presentation, and existing regressions.
- [x] Web production build passes with `npm run build`.
- [x] Babel parses `apps/mobile/src/MapScreen.jsx` and
  `apps/mobile/src/navigation/useNavigationSession.js` using the mobile app's
  checked-in Babel configuration.
- [ ] Expo iOS export. The 2026-06-29 attempt could not start because the command
  approval service reported its execution-usage limit; this is not a bundle
  result and must be rerun.

## Simulator/device acceptance

- [ ] Approach connector appears dashed and guides to the selected route target.
- [ ] Confirmed mid-ride departure computes a forward rejoin without instruction
  thrash.
- [ ] Off-grid/no-path failure keeps Phase A arrow guidance and retries after
  movement; transient failure retries while stationary after backoff.
- [ ] Leaving an active connector triggers a throttled replacement connector.
- [ ] Reaching the main route early abandons the connector cleanly.
- [ ] Pause/resume preserves connector phase; stop during a request ignores its
  late result.
- [ ] Loop/out-and-back handoff resumes near the intended seeded progress.
- [ ] Record the device/build identifiers and observed tuning values below.

## Results

Pending simulator/device execution.
