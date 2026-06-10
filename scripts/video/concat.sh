#!/usr/bin/env bash
#
# Concatenate video segments listed in list.txt, trimming each to [START END],
# and emit a GPS track-log whose timestamps match the concatenated video.
#
# list.txt format (one entry per line):
#
#   file 'NAME.MP4' START [END]
#
# START and END are timestamps in M:SS (or H:MM:SS). END is optional — if it is
# omitted the segment runs to the end of the file. Lines are processed in order.
#
# Outputs (next to this script):
#   concatenated..mp4      video + audio only, stream-copied (no re-encode)
#   concatenated.gps.csv  GPS fixes: time_s,latitude,longitude,altitude_m,speed_mps
#                   where time_s is the offset (seconds) along concatenated.mp4
#
# Why GPS is a sidecar and not embedded: these are GoPro clips with a 'gpmd'
# GPMF telemetry track, but ffmpeg's concat demuxer cannot carry data streams
# across a join (it drops their codec parameters, so the mux fails). Instead we
# trim each segment with stream copy — which DOES preserve gpmd — read the GPS
# out of each trimmed segment, shift every fix by the running video offset so it
# lines up with concatenated.mp4, then concatenate the segments as video+audio only.
# Because cuts are keyframe-bounded (stream copy, no re-encode) the GPS read from
# each trimmed segment is inherently aligned with that segment's frames.
#
# Requires: ffmpeg, ffprobe, exiftool.
# Usage: ./concat.sh [list.txt] [concatenated.mp4]

set -euo pipefail
cd "$(dirname "$0")"

LIST="${1:-list.txt}"
OUT="${2:-concatenated.mp4}"
GPS="${OUT%.*}.gps.csv"

WORK="$(mktemp -d -t concatsegs.XXXXXX)"
CONCAT="$WORK/concat.txt"
trap 'rm -rf "$WORK"' EXIT

# Print a message and abort. Used for anything that makes the run unworkable.
die() { printf 'concat.sh: %s\n' "$*" >&2; exit 1; }

# Convert a [[H:]M:]S timestamp (each field a non-negative integer) to whole
# seconds on stdout. On a malformed timestamp it complains and returns 1 rather
# than feeding garbage to the arithmetic, so callers MUST check it:
#   s=$(to_seconds "$ts") || exit 1
# (return, not exit, because this runs inside $(...) — a subshell whose exit
# would not reliably abort the parent under set -e.)
to_seconds() {
  local ts="$1" total=0 part
  local -a parts
  if [[ ! "$ts" =~ ^[0-9]+(:[0-9]+){0,2}$ ]]; then
    printf "concat.sh: invalid timestamp '%s' (expected [[H:]M:]S, e.g. 0:05 or 1:23:00)\n" "$ts" >&2
    return 1
  fi
  IFS=':' read -ra parts <<< "$ts"
  for part in "${parts[@]}"; do
    total=$(( total * 60 + 10#$part ))
  done
  printf '%s' "$total"
}

printf 'time_s,latitude,longitude,altitude_m,speed_mps\n' > "$GPS"

offset=0        # running start time (s) of the current segment within concatenated.mp4
idx=0

# Read the list on a dedicated fd (9), not stdin: ffmpeg/ffprobe/exiftool below
# inherit fd 0, and ffmpeg in particular reads stdin to poll for keypresses. If
# the loop fed off stdin too, a long-running ffmpeg would swallow bytes from the
# list mid-run and desync the next read (a later 'file ...' line gets sheared,
# e.g. into "0091.MP4' 0:01", which then explodes in to_seconds).
while IFS= read -r line <&9 || [[ -n "$line" ]]; do
  # Skip blank lines and comments.
  [[ -z "${line//[[:space:]]/}" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  # Filename is the text between the first pair of single quotes.
  [[ "$line" == *\'*\'* ]] \
    || die "list line is not in \"file 'NAME' [START [END]]\" form: $line"
  name="${line#*\'}"
  name="${name%%\'*}"
  [[ -n "$name" ]] || die "empty filename in list line: $line"
  [[ -f "$name" ]] || die "file not found: $name (from list line: $line)"
  # Everything after the closing quote is "START [END]".
  rest="${line#*\'"$name"\'}"
  read -r start end _ <<< "$rest"

  # No START -> start at the beginning; no END -> run to the end of the clip.
  # So a bare  file 'NAME.MP4'  with no times takes the whole video.
  if [[ -n "${start:-}" ]]; then
    start_s=$(to_seconds "$start") || exit 1
  else
    start_s=0
  fi
  seg="$WORK/seg_$(printf '%03d' "$idx").mp4"

  # Trim the segment, keeping video + audio + the gpmd GPS track (0:d:1 on these
  # GoPro files; '?' so a clip without it still works). Drop the tmcd timecode.
  dur_args=()
  if [[ -n "${end:-}" ]]; then
    end_s=$(to_seconds "$end") || exit 1
    (( end_s > start_s )) \
      || die "END ($end) must be after START (${start:-0:00}) for $name"
    dur_args=(-t "$(( end_s - start_s ))")
  fi
  ffmpeg -y -v error -ss "$start_s" -i "$name" "${dur_args[@]+"${dur_args[@]}"}" \
    -map 0:v -map 0:a -map '0:d:1?' -c copy -copy_unknown \
    -avoid_negative_ts make_zero "$seg"

  # Append this segment's GPS fixes, shifted onto the concatenated.mp4 timeline.
  # exiftool gives one fix per gpmd packet (~1 Hz); SampleTime restarts at 0 per
  # segment. -f forces a placeholder for any missing field. Only samples with a
  # satellite lock are kept — GPSMeasureMode 2 (2D) or 3 (3D); mode 0 means no
  # fix and yields junk (0,0 or wild coordinates), so those rows are dropped.
  # awk writes the kept rows to stdout (appended to $GPS by the foreground
  # pipeline, so the append fully completes before the script moves on) and the
  # "kept total" counts to a temp file, read back afterwards for the summary.
  exiftool -ee -n -f -api LargeFileSupport=1 \
    -p '$SampleTime,$GPSMeasureMode,$GPSLatitude,$GPSLongitude,$GPSAltitude,$GPSSpeed' \
    "$seg" 2>/dev/null \
    | awk -F, -v off="$offset" -v cf="$WORK/cnt" '
        $1 ~ /^[0-9]/ { total++ }
        $1 ~ /^[0-9]/ && ($2==2 || $2==3) {
          printf "%.3f,%s,%s,%s,%s\n", $1+off, $3, $4, $5, $6; kept++
        }
        END { printf "%d %d\n", kept+0, total+0 > cf }' >> "$GPS"
  read -r kept total < "$WORK/cnt"
  echo "  $name: kept $kept of $total GPS fixes ($(( total - kept )) no-lock dropped)"

  # Advance the offset by this segment's container duration — the same amount
  # the concat demuxer will shift the next segment by.
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$seg")
  offset=$(awk -v a="$offset" -v b="$d" 'BEGIN{printf "%.6f", a+b}')

  printf "file '%s'\n" "$seg" >> "$CONCAT"
  idx=$(( idx + 1 ))
done 9< "$LIST"

# Teleport guard: a fix can report a valid lock yet still be garbage right as the
# receiver re-acquires (e.g. one sample jumps hundreds of km away and back). Drop
# any fix implying a ground speed above MAX_KMH from the previous accepted fix —
# far above any cycling speed, so real motion is never touched. Rows are already
# in ascending time order, so this single pass over $GPS is enough.
MAX_KMH=200
TMPGPS="$WORK/gps_clean.csv"
awk -F, -v max="$MAX_KMH" '
  function hav(la1,lo1,la2,lo2,  r,p,dla,dlo,a) {
    r=6371; p=atan2(0,-1)/180
    dla=(la2-la1)*p; dlo=(lo2-lo1)*p
    a=sin(dla/2)*sin(dla/2)+cos(la1*p)*cos(la2*p)*sin(dlo/2)*sin(dlo/2)
    return 2*r*atan2(sqrt(a),sqrt(1-a))
  }
  NR==1 { print; next }
  {
    if (have) {
      dt=$1-pt; if (dt<=0) dt=0.001
      if (hav(plat,plon,$2,$3)/(dt/3600) > max) { dropped++; next }
    }
    print; have=1; pt=$1; plat=$2; plon=$3
  }
  END { if (dropped) print "  teleport filter: dropped " dropped " outlier fix(es)" > "/dev/stderr" }
' "$GPS" > "$TMPGPS" && mv "$TMPGPS" "$GPS"

# Join the trimmed segments as video + audio only (no GPS in the video itself).
# -write_tmcd 0 drops the GoPro start-of-day timecode track so the result starts
# at 00:00:00 rather than inheriting the recording's wall-clock time.
ffmpeg -y -v error -f concat -safe 0 -i "$CONCAT" -map 0:v -map 0:a -c copy \
  -write_tmcd 0 "$OUT"

echo "Wrote $OUT and $GPS"
