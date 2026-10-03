#!/usr/bin/env bash
set -euo pipefail

# Optional legacy helper for an explicitly requested edit to remove a known
# trailing audio overhang. Stream end-duration differences alone do not indicate
# A/V desynchronization, and the normal workflow does not run this helper.
#
# Usage:
#   scripts/align-export.sh <input.mp4> --output <job-local-path> [--fps <rate>] [--tolerance <seconds>]
#
# The trim target is the video duration plus part of one frame. This may remove
# audible audio; keep the original and always pass a job-local --output path.
# Streams are copied (-c copy), with no re-encode; the input is never modified.

usage() {
  cat <<'EOF'
Usage: scripts/align-export.sh <input.mp4> --output <job-local-path> [--fps <rate>] [--tolerance <seconds>]

Optional: trims a trailing audio overhang after an explicit editorial decision.
Do not use it as an A/V sync check. Exits 0 when the file is already within the
duration tolerance (nothing is written), 1 when it cannot be aligned, and 64 on a
usage error. Stdout is the resulting media path; diagnostics go to stderr.
EOF
}

input="${1:-}"
[[ -n "$input" && "$input" != --* ]] || { usage >&2; exit 64; }
shift || true
output=""
fps_override=""
tolerance=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="${2:-}"; shift 2 ;;
    --fps) fps_override="${2:-}"; shift 2 ;;
    --tolerance) tolerance="${2:-}"; shift 2 ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

[[ -f "$input" ]] || { echo "Input media not found: $input" >&2; exit 66; }
[[ -n "$output" ]] || { echo "--output must point to a job-local destination; the input is never modified" >&2; exit 64; }
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required" >&2; exit 69; }
command -v ffprobe >/dev/null 2>&1 || { echo "ffprobe is required" >&2; exit 69; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 69; }

probe_streams() {
  ffprobe -v error \
    -show_entries format=duration \
    -show_entries stream=codec_type,duration,r_frame_rate,nb_frames \
    -of json "$1"
}

read_probe() {
  # Prints "<video-duration> <audio-duration> <fps> <video-frames>"
  jq -r '
    (.format.duration // "0") as $container
    | ([.streams[] | select(.codec_type == "video")][0]) as $video
    | ([.streams[] | select(.codec_type == "audio")][0]) as $audio
    | if $video == null or $audio == null then error("video and audio streams are required") else . end
    | ($video.r_frame_rate // "0/1") as $rate
    | ($rate | split("/") | (.[0] | tonumber) / ((.[1] // "1") | tonumber)) as $fps
    | [
        ($video.duration // $container | tonumber),
        ($audio.duration // $container | tonumber),
        $fps,
        ($video.nb_frames // 0 | tonumber)
      ] | @tsv
  ' <<< "$1"
}

report() {
  printf 'video %ss  audio %ss  gap %ss  tolerance %ss\n' \
    "$(printf '%.4f' "$1")" "$(printf '%.4f' "$2")" "$(printf '%.4f' "$3")" "$(printf '%.4f' "$4")"
}

streams="$(probe_streams "$input")"
read -r video_duration audio_duration fps frame_count < <(read_probe "$streams")

[[ -n "$fps_override" ]] && fps="$fps_override"

if ! awk -v a="$video_duration" -v b="$audio_duration" 'BEGIN { exit !(a > 0 && b > 0) }'; then
  echo "Could not read positive video and audio durations from $input" >&2
  exit 66
fi
if ! awk -v f="$fps" 'BEGIN { exit !(f > 0) }'; then
  echo "Could not determine the frame rate; pass --fps" >&2
  exit 66
fi

if [[ -z "$tolerance" ]]; then
  tolerance="$(awk -v f="$fps" 'BEGIN { t = 2 / f; if (t < 0.1) t = 0.1; printf "%.6f", t }')"
fi
if ! awk -v t="$tolerance" 'BEGIN { exit !(t ~ /^[0-9]+([.][0-9]+)?$/ && t > 0) }'; then
  echo "--tolerance must be a positive number" >&2
  exit 64
fi

gap="$(awk -v a="$video_duration" -v b="$audio_duration" 'BEGIN { g = a - b; if (g < 0) g = -g; printf "%.6f", g }')"
echo "Input: $input" >&2
report "$video_duration" "$audio_duration" "$gap" "$tolerance" >&2

if awk -v g="$gap" -v t="$tolerance" 'BEGIN { exit !(g <= t) }'; then
  echo "Already within tolerance; use the original file." >&2
  printf '%s\n' "$input"
  exit 0
fi

# Keep every video frame: the target sits just past the video track's end.
target="$(awk -v v="$video_duration" -v f="$fps" 'BEGIN { printf "%.6f", v + (1 / f) / 2 }')"
longest="$(awk -v a="$video_duration" -v b="$audio_duration" 'BEGIN { printf "%.6f", (a > b ? a : b) }')"

if awk -v t="$target" -v l="$longest" 'BEGIN { exit !(t >= l) }'; then
  echo "The audio track is not the longer stream; nothing to trim." >&2
  exit 1
fi

if [[ "$(cd "$(dirname "$output")" 2>/dev/null && pwd)/$(basename "$output")" == "$(cd "$(dirname "$input")" && pwd)/$(basename "$input")" ]]; then
  echo "Refusing to overwrite the input; choose a different --output" >&2
  exit 64
fi

mkdir -p "$(dirname "$output")"
staging_directory="$(mktemp -d "$(dirname "$output")/.align-XXXXXX")"
trap 'rm -rf "$staging_directory"' EXIT
staging="${staging_directory}/aligned.mp4"

echo "Trimming to ${target}s (video ${video_duration}s + half a frame at ${fps}fps)" >&2
ffmpeg -hide_banner -loglevel error -y -i "$input" -c copy -t "$target" -movflags +faststart "$staging"

verify="$(probe_streams "$staging")"
read -r out_video out_audio out_fps out_frames < <(read_probe "$verify")
if ! awk -v v="$out_video" -v a="$out_audio" -v before="$video_duration" -v f="$fps" 'BEGIN { exit !(v > 0 && a > 0 && v >= before - 1 / f) }'; then
  echo "Alignment failed: invalid or shortened video stream" >&2
  exit 1
fi
out_gap="$(awk -v a="$out_video" -v b="$out_audio" 'BEGIN { g = a - b; if (g < 0) g = -g; printf "%.6f", g }')"
report "$out_video" "$out_audio" "$out_gap" "$tolerance" >&2

if ! awk -v g="$out_gap" -v t="$tolerance" 'BEGIN { exit !(g <= t) }'; then
  echo "Alignment failed: the durations still differ by ${out_gap}s" >&2
  exit 1
fi

if [[ "$frame_count" != "0" && "$out_frames" != "0" && "$frame_count" != "$out_frames" ]]; then
  echo "Alignment dropped video frames (${frame_count} -> ${out_frames})" >&2
  exit 1
fi

mv "$staging" "$output"
echo "Aligned and verified." >&2
printf '%s\n' "$output"
