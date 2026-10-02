#!/usr/bin/env bash
set -euo pipefail

# ChatCut renders its preview in the browser, so the exported MP4 often carries an
# audio track slightly longer than the video track. The workflow's media lock
# rejects that with "audio and video durations differ" (tolerance max(0.1, 2/fps)),
# and the fix used to be applied by hand every time.
#
# Usage:
#   scripts/align-export.sh <input.mp4> [--output <path>] [--fps <rate>] [--tolerance <seconds>]
#
# The trim target is the video duration plus part of one frame, so every video
# frame survives while the duration gap shrinks below tolerance. Streams are copied
# (-c copy): no re-encode. The input is never modified; without --output the result
# is written next to it as <name>.aligned.mp4.

usage() {
  cat <<'EOF'
Usage: scripts/align-export.sh <input.mp4> [--output <path>] [--fps <rate>] [--tolerance <seconds>]

Trims a trailing audio overhang so the media lock's duration tolerance passes,
without dropping video frames and without re-encoding. Exits 0 when the file is
already within tolerance (nothing is written), 1 when it cannot be aligned, and 64
on a usage error.
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

gap="$(awk -v a="$video_duration" -v b="$audio_duration" 'BEGIN { g = a - b; if (g < 0) g = -g; printf "%.6f", g }')"
echo "Input: $input"
report "$video_duration" "$audio_duration" "$gap" "$tolerance"

if awk -v g="$gap" -v t="$tolerance" 'BEGIN { exit !(g <= t) }'; then
  echo "Already within tolerance; nothing to align."
  exit 0
fi

# Keep every video frame: the target sits just past the video track's end.
target="$(awk -v v="$video_duration" -v f="$fps" 'BEGIN { printf "%.6f", v + (1 / f) / 2 }')"
longest="$(awk -v a="$video_duration" -v b="$audio_duration" 'BEGIN { printf "%.6f", (a > b ? a : b) }')"

if awk -v t="$target" -v l="$longest" 'BEGIN { exit !(t >= l) }'; then
  echo "The audio track is not the longer stream; nothing to trim." >&2
  exit 1
fi

if [[ -z "$output" ]]; then
  directory="$(cd "$(dirname "$input")" && pwd)"
  base="$(basename "$input")"
  output="${directory}/${base%.*}.aligned.mp4"
fi
if [[ "$(cd "$(dirname "$output")" 2>/dev/null && pwd)/$(basename "$output")" == "$(cd "$(dirname "$input")" && pwd)/$(basename "$input")" ]]; then
  echo "Refusing to overwrite the input; choose a different --output" >&2
  exit 64
fi

mkdir -p "$(dirname "$output")"
staging="${output}.aligning.mp4"
rm -f "$staging"

echo "Trimming to ${target}s (video ${video_duration}s + half a frame at ${fps}fps)"
ffmpeg -hide_banner -loglevel error -y -i "$input" -c copy -t "$target" -movflags +faststart "$staging"
mv "$staging" "$output"

verify="$(probe_streams "$output")"
read -r out_video out_audio out_fps out_frames < <(read_probe "$verify")
out_gap="$(awk -v a="$out_video" -v b="$out_audio" 'BEGIN { g = a - b; if (g < 0) g = -g; printf "%.6f", g }')"
echo "Output: $output"
report "$out_video" "$out_audio" "$out_gap" "$tolerance"

if ! awk -v g="$out_gap" -v t="$tolerance" 'BEGIN { exit !(g <= t) }'; then
  echo "Alignment failed: the durations still differ by ${out_gap}s" >&2
  exit 1
fi

if [[ "$frame_count" != "0" && "$out_frames" != "0" && "$frame_count" != "$out_frames" ]]; then
  echo "Alignment dropped video frames (${frame_count} -> ${out_frames})" >&2
  exit 1
fi

echo "Aligned and verified."
