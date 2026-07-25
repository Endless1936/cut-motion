#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <input.json> <cut-start> <cut-end> <output.json>" >&2
  exit 64
fi

input_json="$1"
cut_start="$2"
cut_end="$3"
output_json="$4"

awk "BEGIN { exit !($cut_end > $cut_start) }" || { echo "cut-end must be greater than cut-start" >&2; exit 64; }
input_absolute="$(cd "$(dirname "$input_json")" && pwd)/$(basename "$input_json")"
mkdir -p "$(dirname "$output_json")"
output_absolute="$(cd "$(dirname "$output_json")" && pwd)/$(basename "$output_json")"
[[ "$input_absolute" != "$output_absolute" ]] || { echo "Output must differ from input" >&2; exit 64; }

jq --argjson cut_start "$cut_start" --argjson cut_end "$cut_end" '
  def rounded: ((. * 1000000) | round) / 1000000;
  def shifted($value):
    if $value >= $cut_end then ($value - ($cut_end - $cut_start)) | rounded
    elif $value > $cut_start then $cut_start
    else $value
    end;
  walk(
    if type == "object" then
      with_entries(
        if ((.key == "start" or .key == "end" or .key == "time" or .key == "audioAnchorTime") and (.value | type) == "number")
        then .value |= shifted(.)
        else .
        end
      )
    else .
    end
  )
  | if (.duration | type) == "number" then .duration = ((.duration - ($cut_end - $cut_start)) | rounded) else . end
' "$input_json" > "$output_absolute"
