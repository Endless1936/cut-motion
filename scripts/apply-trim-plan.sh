#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <input-media> <trim-plan.json> <output.mp4>" >&2
  exit 64
fi

input_media="$1"
trim_plan="$2"
output_media="$3"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input_absolute="$(cd "$(dirname "$input_media")" && pwd)/$(basename "$input_media")"
mkdir -p "$(dirname "$output_media")"
output_media="$(cd "$(dirname "$output_media")" && pwd)/$(basename "$output_media")"
[[ "$input_absolute" != "$output_media" ]] || { echo "Output must differ from input media" >&2; exit 64; }

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
command -v jq >/dev/null
node "$script_directory/check-trim-plan.mjs" "$trim_plan" >/dev/null

duration_seconds="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$input_media")"
fps="$(jq -r '.fps // 30' "$trim_plan")"
remove_count="$(jq '.remove | length' "$trim_plan")"

if [[ "$remove_count" -eq 0 ]]; then
  ffmpeg -hide_banner -y -i "$input_media" -c:v libx264 -r "$fps" -g "${fps%.*}" -keyint_min "${fps%.*}" -movflags +faststart -c:a aac -b:a 192k "$output_media"
  exit 0
fi

filter_graph=""
video_concat_inputs=""
cursor_seconds="0"
segment_starts=()
segment_ends=()
segment_transition_frames=()

for ((remove_index=0; remove_index<remove_count; remove_index++)); do
  remove_start_frame="$(jq -r ".remove[$remove_index].startFrame" "$trim_plan")"
  remove_end_frame="$(jq -r ".remove[$remove_index].endFrame" "$trim_plan")"
  remove_start="$(awk "BEGIN { printf \"%.9f\", $remove_start_frame / $fps }")"
  remove_end="$(awk "BEGIN { printf \"%.9f\", $remove_end_frame / $fps }")"

  if awk "BEGIN { exit !($remove_start > $cursor_seconds) }"; then
    segment_starts+=("$cursor_seconds")
    segment_ends+=("$remove_start")
    segment_transition_frames+=("$(jq -r ".remove[$remove_index].audioTransitionFrames" "$trim_plan")")
  fi

  cursor_seconds="$remove_end"
done

if awk "BEGIN { exit !($duration_seconds > $cursor_seconds) }"; then
  segment_starts+=("$cursor_seconds")
  segment_ends+=("$duration_seconds")
fi

segment_count="${#segment_starts[@]}"
if [[ "$segment_count" -eq 0 ]]; then
  echo "Trim plan removes the entire input media" >&2
  exit 65
fi

audio_transition_seconds_by_seam=()
for ((segment_index=0; segment_index<segment_count-1; segment_index++)); do
  segment_duration="$(awk "BEGIN { printf \"%.9f\", ${segment_ends[$segment_index]} - ${segment_starts[$segment_index]} }")"
  next_segment_duration="$(awk "BEGIN { printf \"%.9f\", ${segment_ends[$((segment_index + 1))]} - ${segment_starts[$((segment_index + 1))]} }")"
  transition_frames="${segment_transition_frames[$segment_index]:-0}"
  audio_transition_seconds_by_seam+=("$(awk "BEGIN { value=$transition_frames / $fps; if (value > $segment_duration / 2) value=$segment_duration / 2; if (value > $next_segment_duration / 2) value=$next_segment_duration / 2; printf \"%.9f\", value }")")
done

for ((segment_index=0; segment_index<segment_count; segment_index++)); do
  segment_start="${segment_starts[$segment_index]}"
  segment_end="${segment_ends[$segment_index]}"
  audio_end="$segment_end"
  if [[ "$segment_index" -lt $((segment_count - 1)) ]]; then
    transition_seconds="${audio_transition_seconds_by_seam[$segment_index]}"
    audio_end="$(awk "BEGIN { value=$segment_end + $transition_seconds; if (value > $duration_seconds) value=$duration_seconds; printf \"%.9f\", value }")"
  fi
  filter_graph+="[0:v]trim=start=${segment_start}:end=${segment_end},setpts=PTS-STARTPTS[v${segment_index}];"
  filter_graph+="[0:a]atrim=start=${segment_start}:end=${audio_end},asetpts=PTS-STARTPTS[a${segment_index}];"
  video_concat_inputs+="[v${segment_index}]"
done

filter_graph+="${video_concat_inputs}concat=n=${segment_count}:v=1:a=0[vout];"
if [[ "$segment_count" -eq 1 ]]; then
  filter_graph+="[a0]anull[aout]"
else
  audio_chain="a0"
  for ((segment_index=1; segment_index<segment_count; segment_index++)); do
    transition_seconds="${audio_transition_seconds_by_seam[$((segment_index - 1))]}"
    audio_output="ax${segment_index}"
    if awk "BEGIN { exit !($transition_seconds > 0) }"; then
      filter_graph+="[${audio_chain}][a${segment_index}]acrossfade=d=${transition_seconds}:c1=tri:c2=tri[${audio_output}];"
    else
      filter_graph+="[${audio_chain}][a${segment_index}]concat=n=2:v=0:a=1[${audio_output}];"
    fi
    audio_chain="$audio_output"
  done
  filter_graph+="[${audio_chain}]anull[aout]"
fi

ffmpeg -hide_banner -y -i "$input_media" -filter_complex "$filter_graph" \
  -map "[vout]" -map "[aout]" -c:v libx264 -r "$fps" -g "${fps%.*}" \
  -keyint_min "${fps%.*}" -movflags +faststart -c:a aac -b:a 192k "$output_media"
