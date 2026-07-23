# Navigation Demo Studio operator guide

The studio turns one or more GoPro files from a ride into a repeatable
CycleWays navigation demo. It runs locally in a token-protected browser
workspace on this Mac. The website owns the normal workflow; the CLI remains
available for automation and troubleshooting.

## Prerequisites

- macOS with Xcode and one booted iOS Simulator;
- the CycleWays development app installed in that Simulator;
- `ffmpeg`, `ffprobe`, `exiftool`, and Swift on `PATH`;
- a GoPro video with GPMF GPS, or the video plus an already aligned CSV;
- enough free space for the source, Simulator capture, and render intermediates.

Start the complete Studio from the repository root:

```sh
npm run demo:studio
```

Create or resume a project in the browser. Paste one video path per line, in
ride order. GoPro chapter files become one virtual timeline, while each file
retains its own GPS extraction and local media clock. The browser then guides:

```text
Footage → Route & map → Showcases → App capture → Final edit → Publish
```

Doctor, inspection, validation, Simulator capture, rendering, and publishing
run as persistent local jobs. It is safe to close the browser. A job continues
independently and appears again when the Studio is reopened. If a job process
dies, it becomes interrupted and retryable with its previous log preserved.

For scripted creation, repeat `--source` in ride order:

```sh
npm run demo:studio -- new upper-galilee-proof \
  --source "/path/GX010123.MP4" \
  --source "/path/GX020123.MP4" \
  --route sovev-beit-hillel
```

For an aligned sidecar in the CLI, place the matching repeated `--csv` argument
in the same position as its video. Projects remain under
`build/demo-studio/<name>/` and contain an executable `studio` launcher.

Before each Simulator capture, the job boots/selects Simulator, starts Metro
when necessary, builds and installs CycleWays when missing, terminates stale
app state, and cold-launches the capture deep link. Progress and logs remain
visible in the browser.

## Iterating safely

Every capture and render gets a new immutable attempt ID. A failed retry never
replaces an accepted attempt. Every Studio decision writes a complete revision
snapshot. History & restore creates a new revision from an earlier decision
point; it never erases later attempts or published files.

Configuration changes require a reason and show their impact before saving:

```sh
./studio configure source.gpsOffsetSeconds 1.3 \
  --reason "Bridge railing aligns at 00:42"
```

The web workspace shows the impact before common edits. Footage order, GPS,
route, or capture-window changes require validation and recapture. Layout,
audio, caption, and post-capture showcase trims preserve the accepted app
capture and require only a new render. Changes to app/map source code are
fingerprinted during validation, so they require a new capture while retaining
the ride preparation.

Reject an attempt when it should remain in history but must not be reused:

```sh
./studio reject capture-001 --note "Map tiles blank from 00:47 to 00:49"
./studio capture proof --retry-from capture-001
```

`./studio make proof` runs safe current stages and stops at the next required
human decision. It never accepts an input, capture, or render automatically.

## Privacy and publication

Raw media, exact GPS, attempt logs, and the private project state remain under
the ignored `build/demo-studio/` workspace. The iOS app receives a sanitized
bundle without source paths. `publish proof` accepts only the current explicitly
approved render, strips source metadata during rendering, and copies a redacted
validation report beside the film.
