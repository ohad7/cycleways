# Navigation Demo Studio operator guide

The studio turns an existing GoPro ride into a repeatable CycleWays navigation
demo. It runs locally: the guided workflow is a CLI, while alignment and
acceptance happen in a token-protected browser workspace on this Mac.

## Prerequisites

- macOS with Xcode and one booted iOS Simulator;
- the CycleWays development app installed in that Simulator;
- `ffmpeg`, `ffprobe`, `exiftool`, and Swift on `PATH`;
- a GoPro video with GPMF GPS, or the video plus an already aligned CSV;
- enough free space for the source, Simulator capture, and render intermediates.

Run commands from the repository root until the project is created:

```sh
npm run demo:studio -- new upper-galilee-proof \
  --source /path/to/ride.mp4 \
  --route sovev-beit-hillel
```

For an aligned sidecar, keep the video as `--source` and add
`--csv /path/to/ride.gps.csv`.

The project is created under `build/demo-studio/<name>/` and contains an
executable `studio` launcher. From that directory the normal workflow is:

```sh
./studio doctor
./studio inspect
./studio validate
./studio review
./studio capture proof
./studio review --run capture-001
./studio accept capture-001 --note "Full ride reviewed at 1x"
./studio render proof
./studio review --run render-001
./studio accept render-001 --note "Captions, sync and audio approved"
./studio publish proof
```

`review` starts the local web UI and opens it in the default browser. Keep the
terminal process running while the page is open; press `Ctrl-C` to close it.

## Iterating safely

Every capture and render gets a new immutable attempt ID. A failed retry never
replaces an accepted attempt. Use `./studio status` after any edit; it explains
what became stale and suggests the smallest next command.

Configuration changes require a reason and show their impact before saving:

```sh
./studio configure source.gpsOffsetSeconds 1.3 \
  --reason "Bridge railing aligns at 00:42"
```

The web workspace exposes the common visual edits: GPS offset, proof in/out,
road/app split, audio gains, caption language, and reviewed translations. GPS,
route, or proof-window changes require revalidation and recapture. Layout,
audio, or caption changes preserve the accepted app capture and require only a
new render.

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
