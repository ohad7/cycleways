#!/usr/bin/env bash
#
# 5x speed version of process.sh — same look, but smoother (less frame skipping
# than 10x) and with the audio kept and sped up 5x to stay in sync.
#
# Video: 5x faster (setpts=PTS/5), scaled to 1440p with lanczos, 30 fps output,
#        HEVC via VideoToolbox — identical settings to process.sh.
# Audio: sped up 5x with an atempo chain (2.0 * 2.0 * 1.25 = 5.0). atempo keeps
#        the original pitch, so it sounds like natural fast-forward rather than
#        chipmunk. For a raw, higher-pitched speed-up instead, swap the -af line
#        for:  -af "asetrate=48000*5,aresample=48000"
#
# Usage: ./process_5x.sh [concatenated.mp4] [processed_5x.mp4]

ffmpeg -y -i "${1:-concatenated.mp4}" \
  -vf "setpts=PTS/5,scale=2560:1440:flags=lanczos" -r 30 \
  -af "atempo=2.0,atempo=2.0,atempo=1.25" \
  -c:v hevc_videotoolbox -q:v 60 -tag:v hvc1 -pix_fmt yuv420p \
  -c:a aac -b:a 160k \
  -write_tmcd 0 -movflags +faststart "${2:-processed_5x.mp4}"
