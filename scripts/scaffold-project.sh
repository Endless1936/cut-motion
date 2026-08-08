#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "Usage: $0 <job-directory> <source-video> [review|auto] [motion-copy|subtitles]" >&2
  exit 64
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
job_directory="$1"
source_video="$2"
workflow_mode="${3:-review}"
caption_mode="${4:-subtitles}"
caption_mode_source="default"
caption_mode_acknowledged=false
if [[ $# -ge 4 ]]; then
  caption_mode_source="user"
  caption_mode_acknowledged=true
fi
job_id="$(basename "$job_directory" | tr '[:upper:]_' '[:lower:]-')"
source_name="$(basename "$source_video")"
source_extension="media"
if [[ "$source_name" == *.* && "$source_name" != .* ]]; then
  source_extension="$(printf '%s' "${source_name##*.}" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')"
  [[ -n "$source_extension" ]] || source_extension="media"
fi
source_relative_path="input/source.${source_extension}"
created_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

[[ "$workflow_mode" == "review" || "$workflow_mode" == "auto" ]] || { echo "Invalid workflow mode: $workflow_mode" >&2; exit 64; }
[[ "$caption_mode" == "motion-copy" || "$caption_mode" == "subtitles" ]] || { echo "Invalid caption mode: $caption_mode" >&2; exit 64; }
[[ -f "$source_video" && -r "$source_video" ]] || { echo "Source video is not a readable file: $source_video" >&2; exit 66; }

if [[ -d "$job_directory" && -n "$(find "$job_directory" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "Job directory is not empty: $job_directory" >&2
  exit 73
fi

mkdir -p "$job_directory/input/reference-scripts" "$job_directory/state" "$job_directory/roughcut" "$job_directory/docs" "$job_directory/captions" "$job_directory/previews" "$job_directory/checkpoints" "$job_directory/logs" "$job_directory/output"
cp -R "$repository_root/templates/hyperframes" "$job_directory/hyperframes"
node "$repository_root/scripts/build-composition.mjs" "$job_directory/hyperframes"
cp -p "$repository_root/templates/job/WORKSPACE.md" "$job_directory/WORKSPACE.md"
cp -p "$repository_root/templates/job/motion-plan.md" "$job_directory/docs/motion-plan.md"
if [[ "$caption_mode" == "motion-copy" ]]; then
  cp -p "$repository_root/templates/job/creative-confirmation.motion-copy.md" "$job_directory/docs/creative-confirmation.md"
else
  cp -p "$repository_root/templates/job/creative-confirmation.md" "$job_directory/docs/creative-confirmation.md"
  cp -p "$repository_root/templates/job/caption-plan.md" "$job_directory/docs/caption-plan.md"
fi
cp -p "$repository_root/templates/job/caption-lexicon.json" "$job_directory/captions/caption-lexicon.json"
cp -p "$repository_root/templates/job/creative-confirmation.json" "$job_directory/state/creative-confirmation.json"
cp -p "$repository_root/templates/job/transcript-reconciliation.json" "$job_directory/state/transcript-reconciliation.json"
cp -p "$repository_root/templates/job/reference-script-annotations.json" "$job_directory/state/reference-script-annotations.json"
cp -p "$source_video" "$job_directory/$source_relative_path"
jq --arg job_id "$job_id" --arg source_video "$source_relative_path" '.id = $job_id | .sourceVideo = $source_video' "$repository_root/motion-project.example.json" > "$job_directory/state/project.json"
jq --arg job_id "$job_id" --arg source_video "$source_relative_path" --arg mode "$workflow_mode" --arg caption_mode "$caption_mode" --arg caption_mode_source "$caption_mode_source" --argjson caption_mode_acknowledged "$caption_mode_acknowledged" --arg created_at "$created_at" '.jobId = $job_id | .authoritativeMediaPath = $source_video | .mode = $mode | .roughCutReviewDecision = "pending" | .captionMode = $caption_mode | .captionModeSource = $caption_mode_source | .captionModeAcknowledged = $caption_mode_acknowledged | .createdAt = $created_at' "$repository_root/templates/job/workflow.json" > "$job_directory/state/workflow.json"
creative_confirmation_status="default-proposed"
if [[ "$caption_mode_acknowledged" == "true" ]]; then creative_confirmation_status="acknowledged"; fi
jq --arg caption_mode "$caption_mode" --arg caption_mode_source "$caption_mode_source" --arg caption_status "$creative_confirmation_status" '.captionMode = $caption_mode | .captionModeDecision.status = $caption_status | .captionModeDecision.source = $caption_mode_source' "$job_directory/state/creative-confirmation.json" > "$job_directory/state/creative-confirmation.json.tmp"
if [[ "$caption_mode" == "motion-copy" ]]; then
  jq 'del(.storyboard.captionPlan)' "$job_directory/state/creative-confirmation.json.tmp" > "$job_directory/state/creative-confirmation.json.motion-copy"
  mv "$job_directory/state/creative-confirmation.json.motion-copy" "$job_directory/state/creative-confirmation.json.tmp"
fi
mv "$job_directory/state/creative-confirmation.json.tmp" "$job_directory/state/creative-confirmation.json"
cp -p "$repository_root/assets/design-system.default.json" "$job_directory/state/design-system.json"
jq -n --arg source "$source_relative_path" '{source:$source,fps:30,remove:[]}' > "$job_directory/state/trim-plan.json"

echo "Created cut-motion job: $job_directory ($workflow_mode, $caption_mode)"
