#!/usr/bin/env bash
set -euo pipefail

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
    | sed -n '/silence_start\|silence_end/p'
}

if [[ $# -eq 1 ]]; then
  for noise_db in -30 -35 -40; do
    run_detection "$noise_db"
  done
else
  run_detection "$2"
fi
