# CycleWays navigation demo studio — implementation plan

Date: 2026-07-23

Status: v1 continuous proof and Studio v2 website-first/multi-clip/reversible-workspace foundation implemented; Phase 4 editorial variants and Phase 5 physical-iPhone proof remain deferred as designed

Related design: `plans/navigation-demo-studio/design.md`

## Goal

Create a local production pipeline that can take a real GoPro ride with
timestamped GPS, validate it against a CycleWays route, replay it through the
real iOS navigation stack, capture clean synchronized app/voice/event stems,
and render an honest demo film without going on another ride.

The original implementation milestone was deliberately narrow:

> Produce one repeatable, continuous 2–4 minute proof film from one real ride,
> with road footage and the actual CycleWays navigation UI synchronized to the
> same recorded GPS timeline.

“Repeatable” includes the operator experience: a person can create a project,
diagnose prerequisites, inspect and visually approve imperfect inputs, retry a
failed capture without losing a prior attempt, change a caption/layout without
recapturing the app, understand stale artifacts, and publish only an explicitly
accepted passing render. Editing JSON or remembering command order is not part
of the v1 happy path.

The hero edit, vertical cut, full editorial/live replay desk, and physical-
iPhone proof pass follow only after that continuous proof film passes its data,
navigation, capture, privacy, and sync gates. A smaller pre/post-capture review
workspace is part of v1 because calibration and acceptance require human
judgment.

The 2026-07-23 Studio v2 increment expands the operator boundary without
changing the proof's honesty or the shipping navigation authority:

- accept an ordered set of GoPro files as one virtual ride;
- make `npm run demo:studio` open the complete project dashboard;
- run doctor, inspection, validation, Simulator capture, rendering, and
  publishing as persistent local jobs from that dashboard;
- list and resume recent projects after browser/server closure;
- save full revision snapshots and restore an earlier decision point by
  creating a new revision; and
- fingerprint relevant app/map working-tree changes so a changed native
  experience cannot silently reuse an older capture.

## Architecture summary

The implementation has nine cooperating parts:

1. A persistent project/revision model records operator intent, immutable
   attempts, accepted artifacts, dependency digests, staleness, and next steps.
2. A virtual-source layer orders one or more clips, maps local media/GPS time
   onto one global ride clock, and splits final edits at source seams.
3. A Node CLI inspects media, extracts GoPro telemetry, normalizes fixes,
   resolves a route snapshot, validates the ride, and writes an immutable demo
   bundle under the ignored `build/demo-studio/` tree.
4. A loopback-only local server exposes the compiled bundle and a small capture
   control/event protocol to a development iOS build.
5. A website-first project dashboard handles project creation/resume, source
   ordering, route changes, stage orchestration, visual review, acceptance,
   history, restoration, and impact previews.
6. A persistent job runner detaches long operations from the browser/server,
   stores status and logs under the project, and reconciles interrupted jobs on
   restart.
7. A dev-only capture controller loads the bundle, adapts it to the existing
   scenario/navigation interfaces, and injects fixes through an absolute,
   media-clocked location source.
8. An iOS capture command records the Simulator, collects actual navigation and
   speech timing events, and verifies start/end synchronization.
9. A deterministic `ffmpeg` renderer aligns the GoPro and app stems, renders
   voice/captions, produces the proof layout, and strips sensitive metadata.

The shipping navigation session, presentation, camera, route progress, and
voice planner remain the product authorities. The studio provides inputs,
clocking, capture, and post-production; it does not create a parallel demo
navigation engine.

## Explicit v1 decisions

- **Input:** one or more ordered GoPro MP4 files containing GPMF GPS, or clips
  with already aligned CSV sidecars in the repository's existing
  `time_s,latitude,longitude,altitude_m,speed_mps` format. GPX/FIT import is
  deferred.
- **Route:** an explicit catalog slug or route token. The tool never silently
  guesses the published route.
- **Generated workspace:** `build/demo-studio/<demo-id>/`, already covered by
  the repository's ignored `build/` directory.
- **Bundle transport:** JSON over a token-protected loopback HTTP server. This
  avoids generated source imports, Metro restarts, and raw media in app bundles.
- **App entry:** a dev-only deep link carrying the local bundle URL and token.
- **Location injection:** the existing `locationSource` seam, not Simulator
  Core Location spoofing.
- **Clock:** source-video presentation time, scheduled from one monotonic
  capture epoch. Chained relative timers are not accepted for capture.
- **First capture target:** iOS Simulator video plus a separate deterministic
  voice stem. A real iPhone pass is a later QA/credibility gate.
- **First render:** fixed 16:9 proof layout, approximately 68% GoPro and 32%
  app. The v1 review workspace may adjust the split, caption placement, and
  proof in/out points; advanced animation remains deferred.
- **Operator surface:** one loopback web production workspace for the normal
  journey. The CLI remains a deterministic automation/debug client of the same
  reducer and pipeline.
- **Attempt model:** import, capture, voice, and render attempts are immutable;
  acceptance is an explicit project pointer and retries never overwrite it.
- **Basemap:** Mapbox Outdoors may use network/cache during capture. The output
  may be produced without another physical ride, but v1 must not claim a fully
  network-free basemap.
- **Dependencies:** use Node built-ins plus the already required `ffmpeg`,
  `ffprobe`, `exiftool`, Xcode/Simulator, and Apple speech frameworks. Do not
  add a large video framework for v1.

## Global constraints

- Raw camera files and raw GPS stay outside version control.
- The app-facing compiled bundle must not contain an absolute source-media path.
- Capture fixes are never snapped to the route. Projection is diagnostic only.
- Cleanup, interpolation, offsets, and waivers are recorded in provenance.
- Only one constant GPS/video offset is allowed per source segment. Per-cue
  offsets are rejected.
- Demo entry points, bundle loading, controls, and fixtures are absent from
  production bundles. Extend the existing Metro dev-harness replacement and
  test it explicitly.
- The local server binds to `127.0.0.1` by default. LAN binding requires an
  explicit flag, a random token, and a warning that GPS is being exposed.
- All subprocesses use argument arrays with `shell: false`; media paths are
  never interpolated into shell commands.
- Generated directories are written atomically. Existing output is not
  overwritten without an explicit `--force` flag and a validated narrow target.
- Tests use small synthetic/sanitized fixtures, not personal GoPro media.
- The implementation must preserve current SIM and CAM behavior.
- No task should opportunistically refactor unrelated navigation, editor, map,
  or release code.
- Every stage is resumable and content-addressed. Re-running a current stage is
  a cache hit unless the operator asks for a new attempt.
- Every mutation records who/what changed, the previous value, the new value,
  the reason, and the resulting invalidation set.
- `status`, the review workspace, and every command use the same project-state
  reducer; there is no second hidden source of workflow truth.
- A command failure or `Ctrl-C` may mark one attempt failed/aborted but must not
  corrupt the project or change accepted pointers.
- The CLI prints a human summary and concrete next action by default, plus
  stable exit codes and `--json` output for automation.

## Studio v2 implementation record (2026-07-23)

### A. Virtual multi-clip ride — implemented

- [x] Add `inputs.sources[]` while migrating legacy `inputs.source` projects
  in memory and retaining the legacy primary-source view for compatibility.
- [x] Inspect every clip independently, store its hash/probe/trim/GPS cleanup,
  and write `artifacts/media-timeline.json`.
- [x] Shift each cleaned clip track onto one monotonically increasing global
  ride clock and retain `sourceId` on fixes and warnings.
- [x] Serve every allowlisted source through its own tokenized media URL.
- [x] Switch source clips transparently while scrubbing or playing the global
  web timeline.
- [x] Split a showcase at any clip boundary and construct the `ffmpeg` graph
  with the correct input/local time for each resulting segment.
- [x] Check every configured source and aligned CSV in `doctor`.

### B. Website-first orchestration — implemented

- [x] Make bare `npm run demo:studio` start the complete local Studio and open
  the browser; retain `./studio review` as a compatible project-scoped entry.
- [x] Add recent-project selection and in-browser project creation with one or
  more ordered source paths.
- [x] Add the visible production sequence Footage → Route & map → Showcases →
  App capture → Final edit → Publish with status and guarded actions.
- [x] Add in-browser footage ordering, route editing, source/showcase review,
  capture/render review, acceptance, and publication controls.
- [x] Run doctor/inspect/validate/capture/render/publish as allowlisted argv-only
  jobs, never shell strings.
- [x] Let capture boot/select Simulator, start Metro when absent, and
  build/install the CycleWays development app when the selected Simulator does
  not contain it.
- [x] Persist job state and logs under `jobs/`; detach the runner so closing the
  tab or restarting the HTTP server does not terminate active production.
- [x] Reconnect to a live runner by PID and mark a vanished runner interrupted
  and retryable.
- [x] Expose safe cancellation and keep complete logs and earlier attempts.
- [x] Offer Capture another take directly in capture review, preserving the
  current attempt and launching a bounded `--retry-from capture-NNN` job
  without requiring an Accept or Reject decision.
- [x] Distinguish in-bounds post-capture trimming from expanding a showcase:
  offer Edit selection & recapture from the trim modal, return to the full
  selection editor, show invalidation guidance, and guard the transition while
  another capture job is active.

### C. Reversibility and proportional invalidation — implemented

- [x] Write `revisions/revision-NNN.json` atomically for every new revision in
  addition to the append-only history event.
- [x] Restore an earlier snapshot as a new revision, merging later immutable
  attempts back into history rather than deleting them.
- [x] Add History & restore UI with explicit impact copy and current-revision
  protection.
- [x] Treat source order, route, showcase, caption, audio, and layout changes
  according to the existing dependency invalidation graph.
- [x] Preserve post-capture showcase trimming when it remains inside the
  immutable capture envelope.
- [x] Include the relevant dirty working-tree hash with the Git commit in
  bundle provenance so app/map edits trigger a different validation/capture
  input digest.
- [x] Add focused tests for legacy migration, clip-boundary rendering, revision
  restoration, and interrupted-job recovery.

### D. Recoverable GPS coverage and compact operator hierarchy — implemented

- [x] Recover the largest coherent GPS run when an isolated early outlier
  causes the normal greedy cleanup pass to retain fewer than two fixes.
- [x] Record recovery provenance and calculate per-clip usable coverage plus
  leading, trailing, and sustained GPS-unavailable intervals.
- [x] Render GPS-unavailable intervals as striped exclusion zones in showcase
  review and explain why the current selection is blocked.
- [x] Reject overlapping showcase decisions in the local service as well as in
  browser controls.
- [x] Detect sustained route mismatches per source clip, exclude them from
  showcase authoring, and move an untouched automatic proof window to the
  longest route-matching GPS coverage.
- [x] Draw GPS as separate per-clip/per-gap paths, focus the diagnostic map on
  the active clip, and never invent a line across a source boundary.
- [x] Mark each source span directly on the main timeline with a compact clip
  number/name and boundary tick.
- [x] Replace the tall equal-weight production cards with a compact six-step
  progress rail, one contextual Continue action, and a secondary Project
  settings menu.
- [x] Cover recovery, coverage classification, server-side exclusion, and
  compact-workflow markup in automated tests.

### Validation expectations

1. `node --test tests/test-demo-studio-v2.mjs` passes.
2. `npm run test:demo-studio` passes, including loopback server tests when the
   execution environment permits binding `127.0.0.1`.
3. Starting `npm run demo:studio`, closing the browser, reopening the URL, and
   opening the same project shows the same revision and job state.
4. Terminating the HTTP server during a render does not terminate the detached
   runner; restarting the Studio shows the job until it completes.
5. Killing a runner produces an interrupted/retryable job on the next Studio
   start without changing accepted capture/render pointers.
6. A showcase crossing from clip 1 into clip 2 produces two filter segments
   with local source times and one honest transition.
7. Restoring an earlier revision creates a later revision number and leaves all
   later attempt media addressable.

## Planned file map

Exact names may move if an existing module becomes a clearer home, but each
responsibility should remain bounded as follows.

```text
scripts/
  demo-studio.mjs                         # CLI entry
  demo-studio/
    cli.mjs                               # command parsing/dispatch
    workspace.mjs                         # safe atomic output handling
    projectState.mjs                      # revision graph, staleness, acceptance
    doctor.mjs                            # prerequisite/capability diagnosis
    status.mjs                            # human/JSON status + next actions
    process.mjs                           # spawn wrapper, tool preflight
    mediaProbe.mjs                        # ffprobe stream/duration facts
    goproTelemetry.mjs                    # exiftool extraction + row parsing
    normalizeFixes.mjs                    # cleanup, heading, gaps, provenance
    compileBundle.mjs                     # private manifest -> app bundle
    routeSnapshot.mjs                     # catalog/token adapter
    validateRide.mjs                      # route/GPS metrics + gates
    captureServer.mjs                     # loopback bundle/control/event API
    reviewServer.mjs                      # allowlisted local review API/assets
    captureIos.mjs                        # simctl recording orchestration
    captions.mjs                          # event log -> SRT
    voiceRender.mjs                       # utterance placement/mixing
    renderVoice.swift                     # AVSpeechSynthesizer buffer writer
    editDecision.mjs                      # proof/hero/vertical edit schema
    render.mjs                            # ffmpeg graph/argv + output checks
    report.mjs                            # JSON/HTML validation report
    review/
      index.html                          # minimal pre/post-capture workspace
      review.js                           # synchronized player + decisions
      review.css                          # local operator UI

scripts/lib/
  navigation-route-snapshot.mjs           # shared route snapshot builder

packages/core/src/navigation/
  demoBundle.js                           # pure compiled-bundle validation
  demoRideValidation.js                   # pure route/GPS report metrics
  demoScenario.js                         # bundle -> existing scenario shape

apps/mobile/src/dev/
  demoCaptureClient.js                    # tokenized server client
  demoCaptureLaunch.js                    # dev-only deep-link parsing
  emptyDemoCapture.js                     # production Metro replacement

apps/mobile/src/navigation/
  mediaClockPlaybackSource.js             # absolute scheduler/location source
  demoCaptureEvents.js                    # stable event summaries
  useDemoCaptureSession.js                # capture lifecycle controller

apps/mobile/src/planner/
  DevDemoCaptureSlate.jsx                 # ready/flash/error/hold surface

tests/
  fixtures/demo-studio/                   # sanitized probe/telemetry/bundle data
  test-demo-bundle.mjs
  test-demo-cli.mjs
  test-demo-project-state.mjs
  test-demo-doctor-status.mjs
  test-demo-telemetry.mjs
  test-demo-fixes.mjs
  test-demo-route-snapshot.mjs
  test-demo-ride-validation.mjs
  test-demo-scenario.mjs
  test-demo-capture-server.mjs
  test-demo-review-workspace.mjs
  test-media-clock-playback-source.mjs
  test-demo-capture-events.mjs
  test-demo-captions.mjs
  test-demo-render.mjs
  test-demo-production-exclusion.mjs
```

Do not create all files at once. Each task below introduces the minimum slice
needed by the next task.

## Data contracts

### Private project manifest

The private manifest is created and updated by guided CLI/review operations; a
power user may inspect it, but normal operation does not require hand editing.
It may contain an absolute source path because it never leaves the local
workspace:

```js
{
  schemaVersion: 1,
  id: "sovev-beit-hillel-summer",
  source: {
    kind: "gopro-mp4",                 // or "aligned-csv"
    video: "/private/path/GX010123.MP4",
    csv: null,
    trim: { inSeconds: 12.4, outSeconds: 928.0 },
    gpsOffsetSeconds: 0
  },
  route: {
    kind: "catalog-slug",              // or "route-token"
    value: "sovev-beit-hillel"
  },
  capture: {
    locale: "he-IL",
    appearance: "light",
    fontScale: 1,
    device: "iPhone 16 Pro",
    mapProfile: "mapbox-outdoors-prewarmed"
  },
  story: {
    proof: { inSeconds: 200, outSeconds: 380 },
    beats: []
  }
}
```

### Compiled app bundle

The app receives only what it needs to replay:

```js
{
  schemaVersion: 1,
  id: "sovev-beit-hillel-summer",
  routeState: { /* snapshot with geometry, spans, junctions/crossings */ },
  fixes: [
    { lat, lng, altitude, speed, heading, accuracy, timestamp }
  ],
  capture: {
    locale: "he-IL",
    appearance: "light",
    fontScale: 1,
    proof: { inMs: 200000, outMs: 380000, preRollMs: 8000 }
  },
  expectations: {
    forbiddenStatuses: ["error"],
    allowOffRoute: false,
    requireVoice: true
  },
  provenance: {
    sourceSha256: "...",
    routeDigest: "...",
    compiledAt: "...",
    gitCommit: "...",
    toolVersions: { ffmpeg: "...", exiftool: "..." },
    cleanup: { /* counts and explicit transformations */ }
  }
}
```

The served JSON omits source paths, raw telemetry, edit music paths, and private
notes. `validateDemoBundle` rejects unknown schema versions, invalid coordinates,
non-monotonic fixes, fewer than two fixes, timestamps outside the declared
capture range, or an unnavigable route snapshot.

### Capture events

Every capture event uses media time, plus diagnostic wall/monotonic timing:

```js
{
  schemaVersion: 1,
  sequence: 42,
  runId: "...",
  kind: "speech-start",
  mediaTimeMs: 217340,
  monotonicTimeMs: 99342.4,
  dispatchLatenessMs: 8.2,
  payload: {
    utteranceId: "...",
    text: "בעוד 100 מטרים, פנה ימינה",
    language: "he-IL",
    rate: 0.92,
    interruptsCurrentSpeech: false
  }
}
```

Event kinds for v1 are `capture-ready`, `sync-flash-start`,
`sync-flash-end`, `fix-dispatched`, `navigation-state`, `presentation`,
`camera-stage`, `speech-request`, `speech-start`, `speech-done`,
`speech-error`, `capture-hold`, and `capture-error`.

## Operator workflow and project-state contract

### Project state

`project.json` is a small current-state document. `history.jsonl` is append-only
and explains how that state was reached. Large reports and attempts live in
separate immutable directories.

Conceptual state:

```js
{
  schemaVersion: 1,
  id: "upper-galilee-proof",
  revision: 12,
  inputs: {
    source: { path, sha256, trim, gpsOffsetSeconds },
    route: { kind, value, snapshotDigest },
    proofWindow: { inMs, outMs, preRollMs },
    captureProfile: { locale, device, appearance, voice, mapProfile },
    proofEdit: { layout, captions, audio, disclosure }
  },
  stages: {
    source: { state: "ready", digest: "..." },
    track: { state: "ready", digest: "..." },
    navigation: { state: "stale", reason: "gps-offset-changed" },
    capture: { state: "accepted", attemptId: "capture-002" },
    render: { state: "stale", reason: "caption-changed" },
    publish: { state: "blocked", reason: "no-current-accepted-render" }
  },
  attempts: {
    captures: ["capture-001", "capture-002"],
    renders: ["render-001", "render-002"]
  },
  accepted: {
    capture: "capture-002",
    render: null
  }
}
```

State mutations go through a pure reducer with explicit actions. The reducer
computes downstream invalidation from declared dependencies, never from ad hoc
command logic.

Minimum dependency rules:

| Change | Invalidates | Preserves |
| --- | --- | --- |
| Source file/hash or trim | telemetry onward | prior attempts for history |
| GPS cleanup/accuracy/offset | normalized track onward | extraction/raw telemetry |
| Route selection/snapshot | route-fit/navigation onward | source/track |
| Proof window/pre-roll | window validation/capture/render | source, track, route |
| App commit/capture profile | app capture/render | data/navigation validation when logic digest is unchanged only if explicitly attested |
| Voice selection/rate | voice/captions/render; capture only if event timing contract changes | app video otherwise |
| Caption translation/style | render only | accepted app capture and voice |
| Layout/title/audio mix | render only | all capture inputs |

When an accepted attempt becomes stale, keep the accepted pointer for historical
comparison but mark it `accepted-stale`; publication requires a current accepted
render or an explicit, recorded attestation to publish the older app build.

### Guided CLI behavior

Implement these operator-level commands before exposing low-level stages:

```text
new <name>             guided project creation; never overwrites
doctor                 capabilities, disk, tools, Simulator, voice, map readiness
status [--json]        stage table, accepted attempts, stale reasons, next action
inspect                media/GPS summary and review link
configure <field>      validated project mutation with impact preview
route set <slug>       explicit route choice
review [--run <id>]    open first unresolved decision in local web workspace
validate               run current data/navigation gates
capture proof          create a new attempt; never replace accepted attempt
render proof           render from selected current inputs/capture
accept <attempt-id>    human acceptance with optional note
reject <attempt-id>    rejection with note; attempt remains inspectable
make proof             run safe current/cacheable work and stop at human decisions
publish proof          gate, sanitize, copy accepted current render
history                show revisions, attempts, acceptance, and invalidations
```

Each command supports `--project <path>`, `--json`, and `--non-interactive`.
`new` and decisions may prompt only on a TTY. In non-interactive mode, missing
decisions fail with a structured `NEEDS_REVIEW` result rather than choosing a
default.

Human output always contains:

- outcome (`RESULT`);
- plain-language cause (`WHY`) for warning/failure/staleness;
- paths/attempt IDs that were created or preserved (`WROTE`/`KEPT`);
- the smallest safe next command (`NEXT`);
- a log/report path for details.

### Iteration and attempt rules

- Import/compile artifacts may be content-addressed cache entries.
- Capture and render are named immutable attempts even when inputs are equal;
  real-time capture and creative output can differ.
- `--retry` creates a new attempt linked to its predecessor and copies only
  explicit operator choices, never partial media.
- `Ctrl-C` records an aborted attempt after child processes are stopped and
  flushed. It does not advance accepted pointers.
- Failed attempts remain reviewable until an explicit, narrow housekeeping
  command archives them. v1 does not need destructive cleanup.
- A current accepted capture may feed many render attempts.
- Acceptance is never inferred from process exit code.
- `make proof` stops at `needs review`, privacy confirmation, waiver, or
  acceptance; `--yes` cannot approve editorial or honesty judgments.

### Minimum v1 review workspace

The v1 web workspace is a local decision surface, not a general video editor.
It has two modes sharing one synchronized timeline.

**Inputs mode:** source video, route/track plot, one or more numbered showcase
ranges, per-range GPS feedback, and approve/revise actions. Technical
calibration and render controls stay hidden from the default operator flow until
an observed problem makes them relevant.

**Attempt mode:** source/app split playback, frame step, sync markers,
navigation/voice/caption markers, diagnostics, notes, accept/reject, and an
impact preview for proposed changes.

Every save calls the same project reducer used by the CLI, records a reason,
and refreshes status. The review server serves only one project's allowlisted
artifacts and requires the same per-run token as capture transport.

## Phase 0 — prove the source before building the studio

### Task 0: Qualify one real ride and freeze the first proof window

**Writes:** no repository files; operator output goes under
`build/demo-studio/source-audit/`.

This is a one-time bootstrap spike performed before the studio exists. Once
Tasks 1–7A land, repeat the same qualification through `new`, `doctor`,
`inspect`, and the pre-capture review workspace; do not preserve a parallel
manual workflow for operators.

- [ ] Run `ffprobe` on candidate GoPro files and confirm a `gpmd` metadata
  stream or locate an existing aligned CSV sidecar.
- [ ] Use the existing extraction technique from `scripts/video/concat.sh` to
  inspect GPS validity, duration, sample cadence, and coverage.
- [ ] Plot or inspect the track against likely catalog routes.
- [ ] Select an explicit route and a continuous 2–4 minute proof window with a
  visible maneuver, sufficient lead-in, spoken cue opportunity, clean GPS, and
  attractive road footage.
- [ ] Record whether the capture machine can load/prewarm the Mapbox Outdoors
  area. Treat blank tiles as a source-readiness failure for v1.
- [ ] Store source hash, selected route identity, trim window, and any initial
  constant offset in a private draft manifest.

**Exit gate:** a source/route/window combination exists. If no candidate has
usable embedded or aligned GPS, proceed with sanitized synthetic fixtures for
tool development but do not schedule the proof-film acceptance milestone.

## Phase 1 — deterministic bundle compiler

### Task 1: Define and test manifest and compiled-bundle contracts

**Files:**

- Create `packages/core/src/navigation/demoBundle.js`
- Create `tests/test-demo-bundle.mjs`
- Create `scripts/demo-studio/projectState.mjs`
- Create `tests/test-demo-project-state.mjs`
- Create sanitized JSON fixtures under `tests/fixtures/demo-studio/`
- Modify `package.json` to add `test:demo-studio` and include the new test

**Interfaces:**

- `validateDemoProjectManifest(value) -> normalizedManifest`
- `validateDemoBundle(value) -> normalizedBundle`
- `sanitizeDemoBundleForApp(privateBundle) -> appBundle`
- `stableDemoBundleDigest(bundle) -> string`
- `reduceDemoProject(project, action) -> { project, historyEvent, invalidated }`
- `deriveDemoProjectStatus(project, artifacts) -> stageStatus[]`

**Steps:**

- [ ] Write failing tests for schema versions, IDs, time ranges, route kinds,
  coordinate bounds, finite accuracy/speed/heading, strict timestamp order,
  story windows, and unknown fields.
- [ ] Implement pure validation with clear field-path errors such as
  `demo "...": fixes[12].timestamp must be greater than fixes[11]`.
- [ ] Make sanitization remove absolute paths and raw telemetry while preserving
  hashes and cleanup provenance.
- [ ] Use a stable recursive key order for digests; exclude `compiledAt` so the
  same inputs compile to the same content digest.
- [ ] Assert that serializing a sanitized bundle cannot contain the fixture's
  private source directory.
- [ ] Test every input mutation against the dependency table: only downstream
  stages become stale and all attempt records remain.
- [ ] Test acceptance, rejection, accepted-stale, explicit old-build
  attestation, retry lineage, failed/aborted attempts, and publish blocking.
- [ ] Append a history record for every successful mutation with old/new value,
  reason, actor, timestamp, and invalidation list.
- [ ] Make current-state plus append-only history recoverable after a simulated
  crash between temporary write and atomic rename.

**Validation:** `npm run test:demo-studio` passes without native, media, or
network dependencies.

### Task 2: Add the guided CLI, doctor/status, and atomic workspace

**Files:**

- Create `scripts/demo-studio.mjs`
- Create `scripts/demo-studio/cli.mjs`
- Create `scripts/demo-studio/workspace.mjs`
- Create `scripts/demo-studio/doctor.mjs`
- Create `scripts/demo-studio/status.mjs`
- Create `scripts/demo-studio/process.mjs`
- Create `tests/test-demo-cli.mjs`
- Create `tests/test-demo-doctor-status.mjs`
- Modify `package.json` with a `demo:studio` script

**Command surface:**

```text
npm run demo:studio -- new <name>
npm run demo:studio -- doctor [--project <path>]
npm run demo:studio -- status [--project <path>] [--json]
npm run demo:studio -- inspect --video <path>
npm run demo:studio -- compile --manifest <path> [--out <dir>]
npm run demo:studio -- validate --bundle <path>
npm run demo:studio -- serve --bundle <path>
npm run demo:studio -- capture-ios --bundle <path> --output <mov>
npm run demo:studio -- render --edit <path>
npm run demo:studio -- review [--run <id>]
npm run demo:studio -- accept <attempt-id> --note <text>
npm run demo:studio -- reject <attempt-id> --note <text>
npm run demo:studio -- configure <field> <value> [--reason <text>]
npm run demo:studio -- history
npm run demo:studio -- make proof
npm run demo:studio -- publish proof
```

The manifest/bundle commands are an expert/debugging surface used to implement
and troubleshoot stages. Help and operator documentation lead with the guided
project commands; an ordinary iteration must not require those low-level forms.

**Steps:**

- [ ] Implement strict option parsing; unknown flags and missing values fail
  before touching disk.
- [ ] `new` creates the private project through guided prompts, records privacy
  acknowledgement, and leaves a usable `NEXT` command. It never overwrites.
- [ ] Discover `project.json` from the current directory or require
  `--project`; never accidentally select the newest project globally.
- [ ] Default output to `build/demo-studio/<manifest-id>/`.
- [ ] Reject `/`, the repository root, home, `~`, unresolved environment
  variables, symlink escapes, and any non-demo-studio target for destructive
  overwrite/cleanup operations.
- [ ] Write through a sibling temporary directory and rename only after a
  successful compile.
- [ ] Add a reusable `spawnChecked(executable, args)` wrapper using
  `shell: false`, bounded captured output, and error messages that name the
  missing tool or exit status.
- [ ] `doctor` checks tools/versions, free disk, source readability, Xcode,
  Simulator, configured voice, local port, and map-readiness capability. It
  distinguishes blocking from advisory findings and changes no external state.
- [ ] `status` renders the shared stage model, attempts/acceptance, stale
  reasons, and one or more concrete next actions; `--json` uses stable codes.
- [ ] All commands print `RESULT`, and when relevant `WHY`, `WROTE`, `KEPT`,
  `NEXT`, and `DETAILS`.
- [ ] Add signal handling that stops exact child processes, flushes logs,
  records an aborted attempt, and preserves accepted pointers.
- [ ] Implement a dry-run/impact preview for configuration mutations before
  committing their invalidation set.
- [ ] `inspect` and unimplemented later commands may initially fail with a
  stable `not implemented` code, but command parsing and safety are complete.
- [ ] Unit-test paths containing spaces, quotes, Unicode, and leading dashes to
  verify they remain single arguments.

**Validation:** CLI help is useful, a fixture operator can create/reopen a
project without editing JSON, invalid commands never create output, and tests
prove status, next-action, abort, and narrow overwrite behavior.

### Task 3: Probe media and extract GoPro telemetry

**Files:**

- Create `scripts/demo-studio/mediaProbe.mjs`
- Create `scripts/demo-studio/goproTelemetry.mjs`
- Create `tests/test-demo-telemetry.mjs`
- Add sanitized `ffprobe` JSON and `exiftool -ee` text fixtures

**Interfaces:**

- `probeMedia(path, deps?) -> { durationSeconds, video, audio, telemetry }`
- `findGpmfStream(probe) -> stream | null`
- `parseExiftoolGpsRows(text) -> { rows, stats }`
- `extractGoproGps(path, options, deps?) -> { rawCsv, rows, probe, stats }`

**Steps:**

- [ ] Write parser tests for GPS5/GPS9-style fields surfaced by `exiftool`,
  missing values, 2D/3D fix modes, no-lock rows, decimal precision, duplicate
  sample times, and malformed output.
- [ ] Invoke `ffprobe -show_streams -show_format -of json` and detect `gpmd` by
  codec tag/type rather than a fixed stream index.
- [ ] Invoke `exiftool -ee -n -api LargeFileSupport=1` with an explicit print
  format and retain its raw output verbatim in the private workspace.
- [ ] Support the existing aligned CSV as an alternate input adapter with the
  same parsed row contract.
- [ ] Record tool versions and source SHA-256.
- [ ] Do not change `scripts/video/concat.sh` in this task. Add a parity fixture
  proving the new parser accepts its current CSV output.
- [ ] Cache extraction by source hash + tool/parser version so changing a title
  or proof window never repeats an hour-long media scan.
- [ ] Print progress for long files without logging coordinates: current media
  time, valid/no-lock counts, elapsed time, and output path.
- [ ] End `inspect` with coverage/gap findings and route to `review` when a human
  must choose a trim/window; do not present hundreds of raw warnings.

**Validation:** parser tests run from fixtures; a manual `inspect` against the
chosen source reports the correct media duration, telemetry stream, valid-fix
count, cadence, and coverage without exposing coordinates to console by
default.

### Task 4: Normalize fixes without falsifying the ride

**Files:**

- Create `scripts/demo-studio/normalizeFixes.mjs`
- Create `tests/test-demo-fixes.mjs`

**Interface:**

```js
normalizeRideFixes(rows, {
  trimInSeconds,
  trimOutSeconds,
  gpsOffsetSeconds,
  defaultAccuracyMeters,
  maxTeleportKmh,
  maxInterpolatedGapSeconds
}) -> { fixes, cleanup, warnings, rejected }
```

**Steps:**

- [ ] Test time normalization onto integer media milliseconds, strict
  monotonic output, trim boundaries, and one constant offset.
- [ ] Drop no-lock, non-finite, out-of-range, non-increasing, and teleport rows;
  count every reason.
- [ ] Use reported 2D speed when valid; derive it only when missing.
- [ ] Derive heading from successive moving fixes; preserve the last reliable
  heading through a stop instead of generating random stationary bearings.
- [ ] Convert an available precision/DOP value through a documented mapping; if
  unavailable, use a named conservative default recorded in provenance.
- [ ] Disable gap interpolation by default. When explicitly enabled, allow only
  gaps within the configured bound and record every synthesized fix.
- [ ] Keep raw valid rows and cleaned fixes as separate artifacts.
- [ ] Reject a source with fewer than two capture fixes or insufficient GPS
  coverage for the declared proof window.
- [ ] Expose every cleanup assumption and candidate offset in the input review
  workspace. A change creates a project revision and invalidates downstream
  stages through the reducer.
- [ ] Show before/after metrics before accepting interpolation or accuracy
  defaults; these decisions require a reason and may not be approved by
  `--yes`.

**Validation:** a synthetic noisy track retains real lateral error and stops,
rejects teleports, and never changes coordinates merely to improve route fit.

### Task 5: Share the current route-snapshot builder

**Files:**

- Create `scripts/lib/navigation-route-snapshot.mjs`
- Modify `scripts/nav-scenario-route-snapshot.mjs` to call the shared builder
- Create `scripts/demo-studio/routeSnapshot.mjs`
- Create `tests/test-demo-route-snapshot.mjs`

**Interfaces:**

- `buildNavigationRouteSnapshot({ catalogSlug | routeToken, name })`
- `routeSnapshotDigest(routeState) -> string`

**Steps:**

- [ ] Extract route decoding, geometry rounding, segment spans, reviewed
  junction attachment, and current crossing attachment into an importable
  helper. Preserve the existing scenario snapshot command's output exactly for
  an unchanged fixture.
- [ ] Return data rather than writing inside the shared helper; callers decide
  whether to emit a JS scenario module or bundle JSON.
- [ ] Fail closed when live route decode, traversal attestation, reviewed
  junctions, or required crossing data are incomplete.
- [ ] Ensure the snapshot is directly accepted by
  `navigationRouteFromRouteState` and contains the same guidance data the app
  would attach during Ride Intro.
- [ ] Digest the navigation-relevant snapshot, not the catalog display wrapper.

**Validation:** existing scenario tests remain green; a catalog slug compiled
for the studio and the scenario snapshot builder produce equivalent navigation
route state and digest.

### Task 6: Build route-fit diagnostics and gates

**Files:**

- Create `packages/core/src/navigation/demoRideValidation.js`
- Create `scripts/demo-studio/validateRide.mjs`
- Create `tests/test-demo-ride-validation.mjs`

**Interfaces:**

- `analyzeDemoRide({ routeState, fixes, visibleWindows, thresholds })`
- `evaluateDemoRideGates(report, waivers?)`

**Steps:**

- [ ] Reuse `packages/core/src/domain/routeGeometryMath.js` for cumulative
  distance and nearest-point projection.
- [ ] Compute valid coverage, median/p95/max route distance, start/end route
  fraction, direction/backtracking, gaps, rejected/interpolated counts, and
  sustained excursions.
- [ ] Report metrics for the whole cleaned ride and separately for every visible
  proof/beat window.
- [x] Gate route fit and GPS continuity on the continuous capture envelope while
  preserving full-source metrics as non-blocking diagnostics when failures are
  wholly outside that envelope.
- [ ] Implement default thresholds from the design as configurable gates, not
  hard-coded navigation behavior.
- [ ] Make waivers structured: `{ gate, reason, approvedBy, approvedAt }`.
  Never accept a boolean `force` that discards the reason.
- [ ] Generate suggested landmarks/windows only as diagnostics; do not silently
  change the manifest.
- [ ] Link every failed gate to the affected time range in the review workspace
  and offer safe actions such as adjust window, choose another route, keep as a
  labeled off-route scene, or abandon the source.
- [ ] Preview the impact of changing the one global GPS/video offset and record
  landmark notes used to justify it.

**Validation:** tests cover clean on-route, noisy but acceptable, reversed,
long-gap, sustained off-route, and loop-seam tracks.

### Task 7: Compile the app bundle and run headless navigation validation

**Files:**

- Create `packages/core/src/navigation/demoScenario.js`
- Create `scripts/demo-studio/compileBundle.mjs`
- Create `tests/test-demo-scenario.mjs`
- Extend `scripts/demo-studio.mjs` `compile` and `validate`

**Interfaces:**

- `demoScenarioFromBundle(bundle) -> scenario`
- `compileDemoBundle(manifest, deps?) -> { privateBundle, appBundle, report }`

**Steps:**

- [ ] Convert the compiled bundle to the normal scenario shape with explicit
  `routeState`, recorded `fixes`, connector policy, expectations, and proof
  bookmark.
- [ ] Resolve it through the existing `resolveScenario`, then run
  `runScenario` to produce the same presentation/voice/camera timeline used by
  tests.
- [ ] Add gate checks for unexpected `error`/off-route/reroute, missing voice,
  premature arrival, duplicate voice, unusable cue density, and an uninteresting
  proof window.
- [x] Replay the full source for navigation warm-up, gate navigation health on
  the capture envelope, and require voice inside the final showcase ranges.
- [ ] Write `bundle.private.json`, sanitized `bundle.app.json`,
  `navigation-timeline.json`, `validation-report.json`, normalized fixes, and
  source/route provenance atomically.
- [ ] Compile the same inputs twice and assert equal content digests and equal
  app bundles apart from explicitly non-digested build metadata.
- [ ] Make the command exit nonzero when any non-waived gate fails.
- [ ] Reuse current extraction/route/track artifacts by digest and rebuild only
  stale stages. Print cache hits and the reason for every rebuild.
- [ ] Write compilation as a new project revision; never mutate a previously
  captured bundle in place.
- [ ] Make successful automated gates end in `needs review`, not “approved”.
  The operator must accept source/route/offset/window in the input workspace.

### Task 7A: Build the minimum pre-capture review workspace

**Files:**

- Create `scripts/demo-studio/reviewServer.mjs`
- Create `scripts/demo-studio/review/index.html`
- Create `scripts/demo-studio/review/review.js`
- Create `scripts/demo-studio/review/review.css`
- Create `tests/test-demo-review-workspace.mjs`
- Extend CLI `review`

**Steps:**

- [ ] Start a tokenized loopback server for one explicit project and open the
  first unresolved review route in the default browser only when requested.
- [ ] Serve allowlisted source proxy, route/track SVG/JSON, headless timeline,
  reports, and project decisions. Reject path traversal and raw-source access
  outside the project allowlist.
- [ ] Implement synchronized source playback, route/track map, route-distance
  graph, raw/clean toggle, GPS gaps, navigation/voice markers, and frame/time
  readout.
- [ ] Keep global GPS/video offset correction available as an expert recovery
  path, not a default operator control.
- [ ] Add one-or-more showcase in/out controls, automatic pre-roll, per-segment
  GPS feedback, and the affected gate list.
- [ ] Save changes through the shared project reducer and show the downstream
  invalidation impact before confirmation.
- [ ] Add explicit accept/reject/needs-revision actions for current inputs;
  process success alone never accepts them.
- [ ] Reflect the same status/next action shown by the CLI.
- [ ] Add browser tests for timeline sync, offset/window edits, impact preview,
  decision history, token enforcement, and no manual JSON requirement.

**Milestone A:** one real source compiles to a sanitized bundle, passes
route-fit and headless navigation validation, and is visually accepted for
capture by an operator before the Simulator is involved.

## Phase 2 — clean, media-clocked iOS replay

### Task 8: Serve bundles and capture control on loopback

**Files:**

- Create `scripts/demo-studio/captureServer.mjs`
- Create `tests/test-demo-capture-server.mjs`
- Create `apps/mobile/src/dev/demoCaptureClient.js`
- Create `apps/mobile/src/dev/emptyDemoCapture.js`
- Extend CLI `serve`

**Protocol:**

```text
GET  /v1/bundle
GET  /v1/control
POST /v1/client/ready
POST /v1/client/events
POST /v1/client/complete
POST /v1/control/start
POST /v1/control/abort
GET  /v1/status
```

**Steps:**

- [ ] Bind to `127.0.0.1` and generate a high-entropy per-run bearer token.
- [ ] Reuse the project/review server's authentication, allowlist, status, and
  lifecycle primitives rather than starting an unrelated second workflow
  server.
- [ ] Serve only the sanitized app bundle. Use an explicit allowlist for any
  later review assets; never expose arbitrary filesystem paths.
- [ ] Validate request body sizes, schema versions, event sequence numbers, and
  run IDs.
- [ ] Append events to an in-memory ordered run, then atomically persist the
  complete log under the bundle's `capture/<run-id>/` directory.
- [ ] Make every state transition idempotent so polling/retries cannot start a
  second capture.
- [ ] Support LAN only with `--allow-lan`, still token-protected, and display a
  privacy warning.
- [ ] Make the app client time out with a visible capture error rather than
  falling through to real GPS.
- [ ] Expose capture attempt state to CLI/review clients in real time, including
  stage, elapsed time, latest safe cancellation point, and log path.

**Validation:** tests use an ephemeral port and temporary directory to cover
authentication, path traversal, oversized bodies, event ordering, retries,
abort, and successful completion.

### Task 9: Implement the absolute media-clock location source

**Files:**

- Create `apps/mobile/src/navigation/mediaClockPlaybackSource.js`
- Create `tests/test-media-clock-playback-source.mjs`

**Interface:**

```js
createMediaClockPlaybackSource(fixes, {
  visibleInMs,
  visibleOutMs,
  preRollMs,
  now,
  schedule,
  cancelSchedule,
  onDispatch,
  onStateChange
})
```

The returned object implements the existing `locationSource` methods plus
`arm()`, `beginVisiblePlayback()`, `abort()`, and `getDiagnostics()`.

**Steps:**

- [ ] Use one monotonic epoch and calculate every due time from the fix's media
  timestamp, not from the previous callback.
- [ ] On each tick, emit every due fix in order and record lateness per fix.
- [ ] Separate warm-up fixes from visible fixes. Warm-up reconstructs session
  state but marks speech/haptic/capture effects suppressed.
- [ ] Begin the visible window only after the app reports map, route, and
  navigation readiness.
- [ ] Support clean stop/abort/hold; capture mode does not need arbitrary
  scrubbing in v1.
- [ ] Inject fake time/schedulers in tests and simulate callback work over a
  20-minute track. End drift must remain bounded by the scheduler tick rather
  than growing once per fix.
- [ ] Verify late ticks catch up without reordering or duplicating fixes.
- [ ] Leave `createJourneyPlaybackSource` behavior unchanged; SIM/CAM tests must
  pass unmodified.

**Validation:** deterministic fake-clock tests prove start, warm-up, catch-up,
abort, hold, and no cumulative drift.

### Task 10: Add dev-only launch and capture lifecycle

**Files:**

- Create `apps/mobile/src/dev/demoCaptureLaunch.js`
- Create `apps/mobile/src/navigation/useDemoCaptureSession.js`
- Create `apps/mobile/src/planner/DevDemoCaptureSlate.jsx`
- Modify `apps/mobile/App.js`
- Modify `apps/mobile/src/navigation/RootNavigator.jsx` only if params need
  explicit routing
- Modify `apps/mobile/src/screens/BuildScreen.jsx` with thin wiring
- Modify `apps/mobile/metro.config.js`
- Modify `apps/mobile/src/dev/emptyDevHarness.js` or use the dedicated empty
  module
- Create/extend launch and production-exclusion tests

**Lifecycle:**

```text
loading → validating → map-ready → armed → warming → sync-flash
        → playing → hold → complete
                    ↘ error / aborted
```

**Steps:**

- [ ] Recognize `cycleways://build?demo=<encoded-url>&token=<token>` only when
  the caller explicitly enables dev capture. Production launch parsing ignores
  it.
- [ ] Fetch and validate the sanitized bundle before installing a source.
- [ ] Resolve `demoScenarioFromBundle` through the same scenario resolver as
  headless validation.
- [ ] Bind the route and injected source, disable real GPS fallback, and wait
  for route/session/map readiness.
- [ ] Add a map-ready latch using the native map load callback plus a short
  stable period; never capture while base tiles or route layers are blank.
- [ ] Render a clean pre-capture slate, one-frame high-saturation sync flash,
  and final hold. No dev controls or diagnostics are visible during the
  recorded interval.
- [ ] Keep operator instructions on the Mac CLI/review workspace; the recorded
  iOS surface shows only footage-safe slate/flash/hold content.
- [ ] Preserve actual production navigation components and camera behavior.
- [ ] Fix locale, appearance, font scale, orientation, status-bar policy, and
  keep-awake behavior for the run.
- [ ] Keep Discover/Detail/Ride Intro capture out of the first continuous proof
  task; add it with hero editing later.
- [ ] Surface actionable failures to the server (`map-not-ready`,
  `bundle-digest-mismatch`, `voice-unavailable`, `session-error`) with exact
  remediation context, not only a generic alert.
- [ ] Add every capture module to Metro's production replacement set and verify
  the release graph resolves only empty stubs.

**Validation:** node tests cover launch parsing and lifecycle reducers; manual
Simulator validation confirms no SIM/CAM/REC/CAM-diagnostics UI is present.

### Task 11: Record navigation, camera, and actual speech timing

**Files:**

- Create `apps/mobile/src/navigation/demoCaptureEvents.js`
- Create `tests/test-demo-capture-events.mjs`
- Modify `apps/mobile/src/navigation/useNavigationSession.js`
- Modify `apps/mobile/src/navigation/speechAdapter.js`
- Modify `apps/mobile/src/navigation/useNavigationCamera.js` or its existing
  diagnostics callback wiring
- Modify `apps/mobile/src/screens/BuildScreen.jsx` only to pass the capture sink

**Steps:**

- [ ] Add an optional capture-event sink; the default is `null` and adds no
  production behavior.
- [ ] Emit stable, privacy-minimal summaries rather than serializing the entire
  navigation state on every fix.
- [ ] Log fix dispatch time/lateness, status transitions, cue/presentation
  changes, camera stages, and terminal state using fix/media timestamps.
- [ ] Extend speech callbacks to log request, actual `onStart`, completion,
  stop, and error. Captions and clean audio placement use actual start time;
  logic diagnostics retain request time.
- [ ] Include utterance ID, text, language, rate, priority, and interruption
  behavior.
- [ ] Suppress warm-up speech and haptics while still advancing the same
  planner memory that prevents duplicate visible prompts.
- [ ] Batch event uploads without losing sequence order; flush before reporting
  capture complete.
- [ ] Unit-test deduplication, sequence ordering, warm-up suppression, speech
  interruption, and media-time mapping.

**Validation:** headless voice events and captured app voice requests agree for
the same bundle; the capture log includes both sync markers and one terminal
event.

### Task 12: Automate clean Simulator video capture

**Files:**

- Create `scripts/demo-studio/captureIos.mjs`
- Extend CLI `capture-ios`
- Extend process/CLI tests with stubbed subprocesses

**Steps:**

- [ ] Preflight macOS, Xcode tools, exactly one selected booted Simulator,
  writable narrow output, bundle validity, and a reachable capture server.
- [ ] Start the server, open the dev deep link with `xcrun simctl openurl`, and
  wait for `capture-ready` with a bounded timeout.
- [ ] Start `xcrun simctl io <udid> recordVideo` as a child process before
  issuing `control/start`.
- [ ] Let the app own the monotonic epoch, flash, playback, and completion.
- [ ] Stop `recordVideo` gracefully after `capture-hold`, wait for a valid file,
  and kill/clean up only the exact child process on abort.
- [ ] Save `app-clean.mov`, capture events, server log, Simulator/runtime facts,
  and command versions under a unique run directory.
- [ ] Use `ffprobe` to verify resolution, duration, monotonic frame timestamps,
  and expected minimum frame rate.
- [ ] Never delete a previous successful run. A retry receives a new run ID.
- [ ] Create the attempt record before launching subprocesses, update it
  atomically through ready/recording/hold/completed, and mark it aborted/failed
  with preserved logs on any exit.
- [ ] Add `--retry-from <run-id>` to reuse the previous capture plan while
  recording new environment/app facts; it never copies partial video or changes
  the accepted capture.
- [ ] Stream concise progress to CLI and review workspace, and end with
  `RESULT/WHY/KEPT/NEXT` plus links to raw capture and review.
- [ ] Detect common recoverable failures (no booted Simulator, wrong app build,
  map timeout, disk exhaustion, recorder exit, missing terminal event) and
  recommend the narrowest retry instead of asking the operator to restart the
  project.

**Validation:** subprocess unit tests verify command argv and cleanup; a manual
short synthetic bundle produces a clean Simulator video; the real proof bundle
then completes without interaction.

**Milestone B:** the chosen real ride can be replayed and captured repeatedly,
with identical route/fix digests, no visible dev chrome, complete event logs,
and start/end capture-clock error within two output frames. Failed and aborted
attempts remain reviewable, and a successful capture is not used downstream
until explicitly accepted.

## Phase 3 — voice, captions, and the continuous proof film

### Task 13: Generate captions from actual speech events

**Files:**

- Create `scripts/demo-studio/captions.mjs`
- Create `tests/test-demo-captions.mjs`

**Interfaces:**

- `captionsFromCaptureEvents(events, options) -> cues`
- `writeSrt(cues) -> string`

**Steps:**

- [ ] Start captions at `speech-start`, not `speech-request`.
- [ ] End at `speech-done`, the next interrupting utterance, or a bounded
  estimated duration when completion is missing; report which rule was used.
- [ ] Preserve Hebrew/RTL text exactly and emit UTF-8 SRT.
- [ ] Support a reviewed translation dictionary keyed by stable utterance text
  hash/event ID. Missing English translations fail an English-caption render.
- [ ] Expose caption/translation edits in the review workspace with source text,
  timing, line-length/safe-area warnings, revision history, and a render-only
  impact preview.
- [ ] Reject overlapping cues unless they correspond to non-interrupting speech
  that actually overlapped.
- [ ] Test hour boundaries, sub-second precision, RTL strings, interrupts,
  missing completion, and deterministic numbering.

**Validation:** Hebrew SRT text and timing match the captured utterance log.

### Task 14: Render a clean navigation voice stem

**Files:**

- Create `scripts/demo-studio/renderVoice.swift`
- Create `scripts/demo-studio/voiceRender.mjs`
- Extend caption/render tests for placement and interruption

**Steps:**

- [ ] Preflight the configured language/voice and fail explicitly when it is
  unavailable.
- [ ] Use `AVSpeechSynthesizer.write` to render each unique utterance to an
  individual audio file and cache by voice/language/rate/text digest.
- [ ] Preserve actual `speech-start` placement from the capture log.
- [ ] Trim an earlier clip at the next interrupting utterance's start; do not
  let post-produced speech overlap where the app would have stopped it.
- [ ] Mix clips onto a 48 kHz timeline with deterministic `ffmpeg` filters and
  write `voice.wav` plus a placement report.
- [ ] Record the voice identifier and platform version in provenance.
- [ ] Compare a short rendered prompt with the same prompt captured on the
  Simulator/phone. If the available voice materially differs, use live system
  audio for the proof and keep deterministic export blocked until a matching
  voice is selected.
- [ ] Treat voice configuration as a revisioned input. Regenerate only
  voice/captions/render when captured event timing remains compatible; require
  a new app capture when the timing or interruption contract changes.

**Automated validation:** event-to-audio placement, cache keys, interrupt trims,
and filter argv are unit-tested without requiring speech in CI.

**Manual validation:** generated Hebrew speech is intelligible, uses the
intended voice/rate, and matches actual app prompt wording.

### Task 15: Implement sync-marker detection and proof rendering

**Files:**

- Create `scripts/demo-studio/editDecision.mjs`
- Create `scripts/demo-studio/render.mjs`
- Create `tests/test-demo-render.mjs`
- Extend CLI `render`

**Proof edit schema:**

```js
{
  schemaVersion: 1,
  kind: "proof",
  bundleDigest: "...",
  captureRunId: "...",
  source: { inMs: 200000, outMs: 380000 },
  layout: { master: "3840x2160", fps: 30, roadFraction: 0.68 },
  audio: { ambienceGainDb: -14, voiceGainDb: 0 },
  captions: { language: "he", burnIn: true },
  title: { routeName: "...", embeddedGpsDisclosure: true }
}
```

**Steps:**

- [ ] Validate edit decisions against exact bundle and capture digests.
- [ ] Require a current accepted capture. Consuming an accepted-stale capture
  requires an explicit historical-build attestation recorded in project
  history.
- [ ] Detect the known sync-flash color/frame in `app-clean.mov`; cross-check it
  with event-log markers and fail on ambiguity.
- [ ] Align the first post-flash app frame to the proof source in-point.
- [ ] Build the 68/32 layout without stretching the portrait app capture.
- [ ] Add a restrained title/disclosure slate and optional proof timecode.
- [ ] Mix GoPro ambience and `voice.wav`; sidechain/duck ambience around speech
  if needed, without destroying recognizable road sound.
- [ ] Burn Hebrew captions within safe areas and also emit an SRT sidecar.
- [ ] Render a high-quality intermediate and H.264/AAC delivery output with
  `yuv420p`, 48 kHz audio, and fast-start metadata.
- [ ] Strip location/source metadata and verify with `ffprobe`/`exiftool` that
  no GPS, source path, or GoPro telemetry remains.
- [ ] Measure start/end A/V duration, frame count, black/blank frames, loudness,
  peak level, and final file size.
- [ ] Make `render` refuse non-waived failed gates and never overwrite an
  existing deliverable without `--force`.
- [ ] Store every render as `render-NNN` with its edit decision, logs, media
  facts, and predecessor. `--force` may replace only a disposable working file,
  never an immutable completed attempt.
- [ ] Present v1 layout controls (road/app split, caption position, disclosure,
  ambience/voice gain) in the review workspace and show that they invalidate
  only render outputs.
- [ ] End with a post-render review link containing synchronized output,
  diagnostics, accept/reject/notes, and current publish blockers.
- [ ] Make `publish` consume only an explicitly accepted, current, passing
  render; process success never implies acceptance.

**Automated validation:** generate tiny colored synthetic road/app/audio
fixtures with `ffmpeg`, detect the sync frame, render the layout, and assert
dimensions, duration, metadata removal, and audio/caption presence.

**Manual validation:** watch the entire proof film at 1× with headphones and
verify physical turns, app puck/camera, visible instructions, spoken guidance,
and road footage remain credible together.

### Task 16: Complete post-capture/render review and the validation report

**Files:**

- Create `scripts/demo-studio/report.mjs`
- Extend the v1 review workspace with attempt mode
- Extend validation tests

**Report sections:**

- source/media/tool provenance;
- map of raw valid and cleaned fixes against the route;
- cleanup/gap/offset/accuracy assumptions;
- route-fit percentiles and visible-window gates;
- headless navigation status/cue/voice timeline;
- capture scheduler lateness and start/end sync error;
- output media facts, metadata scan, captions, and audio measurements;
- waivers and their reasons;
- final publishable/not-publishable result.

**Steps:**

- [ ] Generate deterministic JSON first, then a self-contained local HTML view.
- [ ] Render the route/track plot as local SVG; do not depend on hosted map
  tiles for the report.
- [ ] Redact exact coordinates and private paths in a shareable report mode.
- [ ] Link every failure to its source artifact/event index.
- [ ] Make a publishable result require all non-waived gates from Phases 1–3.
- [ ] Add attempt selection and side-by-side source/app/output playback, frame
  step, sync/voice/camera markers, diagnostic overlays, and notes.
- [ ] Add accept/reject actions for capture and render attempts through the
  shared reducer; acceptance does not hide warnings or remove prior attempts.
- [ ] For every proposed change, show the exact impact before save: no work,
  report only, rerender, voice+rerender, revalidate, or recapture.
- [ ] Make `status` and `review` agree immediately after every decision and
  recover correctly after closing/reopening the browser.
- [ ] Implement `make proof` as an orchestrator that runs current safe stages,
  reuses caches, and stops with `NEEDS_REVIEW` at required human checkpoints.

**Milestone C / v1 definition of done:**

- The chosen real source compiles deterministically.
- The sanitized app bundle contains no private path.
- Headless and visual runs use the same route/fix digest.
- A 2–4 minute app capture can be repeated without manual navigation input.
- Capture start/end error is within two 30 fps frames.
- The proof film has synchronized road/app/voice/captions, no visible debug UI,
  no unexpected navigation state, and no embedded GPS metadata.
- A validation report marks it publishable.
- A human reviewer confirms the result feels like a real CycleWays ride rather
  than an animated mockup.
- A new operator can complete the workflow through guided CLI/review actions
  without editing JSON or manually locating artifacts.
- One failed capture is retried without losing the previous attempt.
- A caption/layout revision produces a new render without recapturing the app.
- A GPS offset/route/window change correctly invalidates and reruns only its
  dependent stages.
- Publication is blocked until a current render is explicitly accepted, then
  produces a redacted report and preserves full local history.

## Phase 4 — editorial outputs after the proof is credible

### Task 17: Add beat-window reconstruction and capture

**Files:**

- Extend bundle story schema, media-clock source, capture lifecycle, CLI, and
  tests

**Steps:**

- [ ] Compile named beats with `at`, `preRoll`, `postRoll`, and expected cue/
  camera stage.
- [ ] Reconstruct earlier session state during hidden warm-up, then run the
  visible window at 1×.
- [ ] Ensure connector responses, voice memory, cue memory, and route progress
  match a continuous run at the visible in-point.
- [ ] Capture every beat as a separate clean app stem with its own sync markers
  and report.
- [ ] Compare the first visible state against the continuous headless timeline;
  fail when warm-up reconstruction diverges.

**Validation:** tests cover a minute-12 beat, an interrupting cue near the
in-point, an off-route beat, and arrival; no warm-up voice leaks.

### Task 18: Add hero and vertical render templates

**Files:**

- Extend `editDecision.mjs`, `render.mjs`, caption/translation modules, and tests
- Add checked-in safe visual templates/assets only after brand review

**Steps:**

- [ ] Support `hero` and `vertical` edit kinds with explicit source/app beats.
- [ ] Implement the 68/32 default and bounded 58/42 maneuver emphasis
  transition.
- [ ] Add product-tour app stems for Discover, Route Detail, route overview,
  Ride Intro, and Start. These are captured from the real app but are not
  presented as contemporaneous GoPro time.
- [ ] Add reviewed English subtitle lookup while leaving the Hebrew UI intact.
- [ ] Add explicit scene-transition markers wherever ride time is skipped.
- [ ] Keep synthetic recovery/capability scenes in separately labeled segments.
- [ ] Render 4K/1080p landscape and 1080×1920 vertical outputs from the same
  clean stems.

**Validation:** all layouts remain legible at final playback size, captions fit
safe areas, and no edit implies false continuity.

### Task 19: Expand the v1 review workspace into an editorial/live replay desk

**Files:** extend the bounded `scripts/demo-studio/review/` workspace; do not
attach this UI to the public site or shipping app.

**Additional capabilities beyond v1:**

- richer multi-beat hero and vertical decision authoring (naming, reordering,
  and layout-specific selections beyond the shared chronological showcases);
- caption/translation editing and safe-area preview;
- layout-transition and audio-mix preview;
- meeting mode with named beat navigation and presentation-safe controls;
- optional live reconstructed-session controls beside recorded attempt review;
- write-only edit-decision output, not direct video mutation.

**Steps:**

- [ ] Serve only allowlisted artifacts from one bundle workspace.
- [ ] Use the bundle/event/edit schemas as the sole data model.
- [ ] Keep final rendering in the tested `ffmpeg` pipeline.
- [ ] Preserve the v1 project state, acceptance, staleness, history, and impact
  model; do not create a separate editorial project format.
- [ ] Add browser tests for synchronization, marker selection, decision writes,
  and path privacy.

**Validation:** an operator can choose and adjust hero beats without editing
JSON, then reproduce the same render from the saved decision file.

## Phase 5 — physical-device credibility and hardening

### Task 20: Add a physical-iPhone proof workflow

**Files:** capture CLI/client documentation and narrow LAN support; no shipping
feature.

- [ ] Start the tokenized server with explicit `--allow-lan` and show the
  network/privacy warning.
- [ ] Open the dev deep link on a development iPhone build.
- [ ] Use the same compiled bundle, media clock, events, and clean capture mode.
- [ ] Record the screen with sound using iOS screen recording.
- [ ] Import the recording into the run directory and align it by the sync
  flash/event markers.
- [ ] Compare UI, font rendering, camera behavior, voice wording/rate, and event
  timing with the Simulator master.
- [ ] Treat haptics, backgrounding, GPS hardware, and lock-screen behavior as
  separate field-test evidence, not proof-film claims.

**Exit gate:** at least one real-device pass supports the claim that the
Simulator film represents the iOS app rather than a Simulator-only behavior.

### Task 21: Production-exclusion, privacy, and reproducibility hardening

**Files:**

- Create/extend `tests/test-demo-production-exclusion.mjs`
- Update developer documentation only after the commands stabilize
- Add no raw/demo media to version control

**Steps:**

- [ ] Assert every dev capture import resolves to empty stubs when
  `context.dev === false`.
- [ ] Inspect a release bundle for demo URL strings, fixtures, route snapshots,
  control protocol, and source coordinates.
- [ ] Verify the normal production launch ignores demo query parameters.
- [ ] Run the same compile/capture/render twice and compare bundle digest,
  event ordering, duration, sync measurements, and expected output differences.
- [ ] Add a command that prints every public-output metadata tag and fails on
  GPS or absolute paths.
- [ ] Add a privacy confirmation before publishing coordinates or binding to
  LAN.
- [ ] Document supported Xcode, Simulator, ffmpeg, exiftool, and Node versions.
- [ ] Document recovery for missing speech voice, blank Mapbox tiles, capture
  abort, and stale route snapshot.
- [ ] Add forward-only, backup-before-write project schema migrations so an
  older studio project opens with an explanation rather than failing silently.
- [ ] Add read-only disk-usage reporting by stage/attempt. Any future archive or
  cleanup command must protect accepted attempts and show exact targets first.
- [ ] Run the second-operator handoff scenario and capture usability findings;
  fix confusing command/status/review language before calling the studio done.

## Test strategy

### Fast pure tests

Run after each relevant task:

```bash
npm run test:demo-studio
```

This suite must not need a real GoPro file, network, Mapbox token, Simulator,
or installed Apple voice. It covers schemas, parsers, normalization, route-fit
math, scenario adaptation, fake-clock scheduling, event reduction, captions,
server security, subprocess argv, render-graph construction, project
invalidation, immutable attempts, acceptance, status/next-action output, and
abort/retry recovery.

Add a fixture-driven operator-journey test that executes:

```text
new → doctor warning → inspect → revise trim → set route → revise offset
→ validate → accept inputs → failed capture → retry → accept capture
→ render → revise caption/layout → rerender → accept → publish
```

At each step assert stage states, preserved attempts, stale reasons, cache hits,
next actions, and that no JSON hand edit or destructive cleanup is required.

### Media integration tests

Generate tiny synthetic video/audio inputs inside a temporary directory and
run real `ffmpeg`/`ffprobe` when available. Verify sync-marker detection,
layout, duration, audio placement, captions, and metadata stripping. Skip with
an explicit reason only when the media tools are absent; the capture machine
must never skip them.

### Repository regression tests

At the end of Phases 1, 2, and 3:

```bash
npm run test:navigation-camera
npm test
```

Pay particular attention to scenario resolution, navigation replay, voice,
camera, launch target, Metro production replacement, route snapshots, and
existing video-sync tests.

### Manual Simulator acceptance

- Build the dev iOS app on the pinned Simulator/runtime.
- Warm/verify the selected map area.
- Capture a 20-second synthetic smoke bundle.
- Capture the full real proof window twice.
- Watch raw app capture, raw GoPro source, and composed proof at 1×.
- Inspect the event timeline around every visible maneuver and utterance.
- Check start/end sync marker measurements and scheduler lateness.
- Confirm no control/debug UI, permission prompt, loading state, blank tile, or
  notification is visible.
- Interrupt one capture, reopen the project, and confirm the attempt is marked
  aborted with an actionable retry while the accepted capture is unchanged.
- Cause one recoverable preflight failure and verify the CLI/review workspace
  explains it without erasing or restarting earlier work.

### Manual editorial acceptance

- View at normal presentation size, not only full-screen on the editing Mac.
- Listen on speakers and headphones.
- Ask a reviewer unfamiliar with the implementation what they believe is real,
  recorded, simulated, and edited; correct any misleading presentation.
- Proofread Hebrew and reviewed English captions.
- Confirm the disclosure accurately describes GPS replay and edit points.
- Have a second operator start from `project.json`, use `status`/`review` to
  understand the current state, make a caption/layout iteration, rerender, and
  identify exactly what did and did not become stale.

## Acceptance matrix

| Requirement | Automated evidence | Human evidence |
| --- | --- | --- |
| Real GPS is retained | extraction provenance, raw/clean diff, no route snapping | source audit |
| Route matches ride | p50/p95 metrics, headless state gates | junction/road comparison |
| App uses real navigation stack | scenario digest + existing replay/session tests | captured production UI behavior |
| No cumulative clock drift | 20-minute fake-clock test, start/end markers | full proof watch |
| Voice matches guidance | utterance/event/caption equality | listen and compare with app |
| Capture is clean | frame/media checks, production-exclusion test | visual review |
| Output protects privacy | bundle sanitization and metadata scan | coordinate publish review |
| Film is not misleading | explicit continuity/synthetic-scene rules | unfamiliar-viewer review |
| Result is reproducible | bundle/edit digests and rerun report | second successful capture/render |
| Workflow survives failure | abort/retry state tests and immutable attempts | recover one interrupted capture |
| Iteration is proportional | dependency invalidation/cache tests | caption/layout rerender without recapture |
| State is understandable | status/next-action golden tests | second-operator handoff |
| Acceptance is intentional | publish-blocking reducer tests | explicit capture/render approval notes |

## Risks and mitigations

### No usable GoPro GPS

Develop parsers against sanitized fixtures, but block the “real recorded GPS”
proof milestone until an embedded or genuinely aligned sidecar exists. Do not
quietly substitute sparse route keyframes.

### Route data changed since the ride

Record route digest and source date. Use a deliberate historical snapshot only
when it is still truthful and clearly attributed; otherwise fix route data or
choose another ride.

### Mapbox capture is not network-free

Treat map readiness as a capture prerequisite and disclosure issue. A real
offline basemap is a separate product plan; it must not be smuggled into this
tool's scope.

### Speech export differs from live iOS speech

Record actual speech timing, pin voice configuration, compare exported audio
with a live Simulator/phone prompt, and block deterministic export if they do
not match acceptably. The physical-device pass remains the credibility check.

### Warm-up state diverges from a continuous session

Keep the first proof continuous. Later beat capture must compare its first
visible state to the continuous headless timeline and fail closed on divergence.

### The capture controller makes BuildScreen harder to maintain

Keep lifecycle, transport, and event formatting in dedicated modules. Limit
BuildScreen changes to state/action wiring and rendering the capture slate.

### Raw coordinates leak through logs or HTTP

Console output reports counts/metrics by default, not coordinate rows. The app
bundle is sanitized, the server is tokenized/loopback-only, shareable reports
redact coordinates, and final media is scanned for metadata.

### The CLI exposes pipeline complexity to the operator

Keep low-level commands for debugging, but lead with `new`, `status`, `review`,
`make proof`, and concrete next actions. Test the full operator journey, not only
individual modules. A normal project never requires hand-edited JSON.

### Staleness makes iteration feel unpredictable

Use one pure dependency reducer, show impact before every saved change, name the
reason each artifact became stale, and distinguish reusable accepted history
from currently publishable output.

### Failed retries undermine confidence

Attempts are immutable and acceptance pointers do not move on success alone.
Every retry links to its predecessor, preserves logs, and makes comparison easy
in the review workspace.

## Work that is intentionally deferred

- GPX, FIT, Garmin, and non-GoPro action-camera adapters.
- Automatic visual landmark matching between frames and GPS.
- A fully offline native basemap.
- App Store/TestFlight capture entry points.
- Remote/cloud rendering or storage.
- AI-generated narration, automatic English UI replacement, or synthetic road
  footage.
- General-purpose NLE features in the review player.
- Automatic marketing claims based on navigation telemetry.
- Public hosting/deployment of the review desk.

## Final handoff artifacts

When implementation is complete, hand off:

- the private project manifest template with privacy guidance;
- deterministic compiler, validator, server, capture, caption, voice, render,
  and report commands;
- one sanitized test bundle and synthetic media fixtures;
- one private real-ride bundle outside version control;
- raw clean app/voice/event stems for the selected proof;
- the continuous proof film and validation report;
- later, the hero, English-captioned, and vertical variants;
- documented tool/runtime versions and exact rerender commands;
- a short operator guide centered on `new`, `doctor`, `status`, `review`,
  retries, acceptance, staleness, and publishing;
- evidence that production bundles contain none of the demo harness.
