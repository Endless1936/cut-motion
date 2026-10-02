#!/usr/bin/env bash
set -euo pipefail

# Reports dB-only candidate intervals. Review their content before editing; these times are not physical cut points.
if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <media-file> [noise-db] [minimum-seconds=0.45]" >&2
  exit 64
fi

media_file="$1"
minimum_seconds="${3:-0.45}"

run_detection() {
  local noise_db="$1"

  printf 'threshold_db=%s\n' "$noise_db"
  ffmpeg -hide_banner -i "$media_file" -vn -af "silencedetect=noise=${noise_db}dB:d=${minimum_seconds}" -f null - 2>&1 \
    | sed -n '/silence_start/p; /silence_end/p'
}

if [[ $# -eq 1 ]]; then
  printf 'scan_thresholds_db=-30,-35,-40\n'
  ffmpeg -hide_banner -i "$media_file" -vn -af "silencedetect@db30=noise=-30dB:d=${minimum_seconds},silencedetect@db35=noise=-35dB:d=${minimum_seconds},silencedetect@db40=noise=-40dB:d=${minimum_seconds}" -f null - 2>&1 | sed -n '/\[silencedetect@db/p'
else
  printf 'scan_thresholds_db=%s\n' "$2"
  run_detection "$2"
fi
printf 'scan_completed=true\n'
