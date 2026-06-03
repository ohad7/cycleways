# Route Video Processing

Compress a ride video into a 1–3 minute timelapse optimized for YouTube upload.

## Usage

```sh
./processing/process-video.sh source.mp4 processed.mp4 [speedup]
```

- `speedup` (default `15`) — divides duration by this factor. A 30-minute
  source at default speedup becomes a 2-minute video.
- Output is 1440p / 30 fps / HEVC / no audio.

## Why these settings

- **1440p upscale** is the single biggest knob for YouTube playback quality.
  YouTube assigns higher-tier encoders (VP9/AV1) with much more generous
  bitrate to uploads at ≥ 1440p, even when viewers watch at 1080p. Without
  this, 1080p uploads look pixelated.
- **Apple hardware HEVC** (`hevc_videotoolbox`) is roughly 10× faster than
  `libx264 -preset slow` on Apple Silicon. Local encode quality doesn't
  matter much — YouTube re-encodes everything regardless.
- **30 fps** is enough. Source is typically 24 fps; the speedup already
  produces a hyperlapse; 60 fps would double the bitrate for no perceptual
  gain.
- **Audio stripped** — fast-forward audio is unusable.
- **`-pix_fmt yuv420p` + `-tag:v hvc1`** keep the file compatible with
  YouTube and Apple tooling.

## After upload

Wait for YouTube to finish encoding 1440p/2160p renditions before judging
playback quality — for the first few minutes after upload only the cheap
fast-path encode is available, and it looks worse than the final result.

Upload as **unlisted** and copy the video ID into the editor's Video Sync
mode.
