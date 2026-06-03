#!/bin/zsh
# Usage: process-video.sh <input.mp4> <output.mp4> [speedup-factor]
#
# Defaults: 15x speedup, 1440p upscale (for YouTube's quality tier),
# Apple hardware HEVC encode. Strips audio, caps fps at 30.
set -euo pipefail
IN="${1:?missing input}"
OUT="${2:?missing output}"
SPEEDUP="${3:-15}"
ffmpeg -i "$IN" \
  -vf "setpts=PTS/${SPEEDUP},scale=2560:1440:flags=lanczos" \
  -r 30 \
  -an \
  -c:v hevc_videotoolbox -q:v 60 -tag:v hvc1 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  "$OUT"
