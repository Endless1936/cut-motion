#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
mode="${1:---static}"
[[ "$mode" == "--static" || "$mode" == "--runtime" ]] || {
  echo "Usage: scripts/test-media-pipeline.sh [--static|--runtime]" >&2
  exit 64
}

temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

plan="$temporary_root/trim-plan.json"
cat > "$plan" <<'EOF'
{
  "source": "input/source.mp4",
  "fps": 30,
  "remove": [{
    "startFrame": 20,
    "endFrame": 41,
    "classification": "reset-removed",
    "reason": "visible reading reset",
    "semanticEvidence": "duplicate take",
    "confidence": 0.9,
    "audioTransitionFrames": 0
  }]
}
EOF

node "$repository_root/scripts/check-trim-plan.mjs" "$plan" >/dev/null
for mutation in \
  'del(.remove[0].classification)' \
  '.remove[0].pictureAudited = true' \
  '.remove[0].audioTransitionFrames = 3' \
  '.remove += [(.remove[0] | .startFrame = 10 | .endFrame = 12)]' \
  '.remove += [(.remove[0] | .startFrame = 41 | .endFrame = 44)]'; do
  invalid="$temporary_root/invalid.json"
  jq "$mutation" "$plan" > "$invalid"
  if node "$repository_root/scripts/check-trim-plan.mjs" "$invalid" >/dev/null 2>&1; then
    echo "Invalid trim plan unexpectedly passed: $mutation" >&2
    exit 1
  fi
done

cache="$temporary_root/npm-cache"
dependency_job="$temporary_root/dependency-job"
mkdir -p \
  "$cache/_npx/test/node_modules/hyperframes/dist" \
  "$cache/_npx/test/node_modules/gsap/dist" \
  "$dependency_job/hyperframes/assets"
printf '{"version":"0.7.60","bin":{"hyperframes":"dist/cli.js"}}\n' > "$cache/_npx/test/node_modules/hyperframes/package.json"
printf '#!/usr/bin/env node\n' > "$cache/_npx/test/node_modules/hyperframes/dist/cli.js"
printf '{"version":"3.13.0"}\n' > "$cache/_npx/test/node_modules/gsap/package.json"
printf 'gsap cache fixture\n' > "$cache/_npx/test/node_modules/gsap/dist/gsap.min.js"
cp "$repository_root/templates/hyperframes/package.json" "$dependency_job/hyperframes/package.json"
npm_config_cache="$cache" bash "$repository_root/scripts/check-environment.sh" install-job "$dependency_job" --yes >/dev/null
[[ -L "$dependency_job/hyperframes/node_modules/hyperframes" ]] || {
  echo "Exact cached HyperFrames was not linked" >&2
  exit 1
}
[[ -L "$dependency_job/hyperframes/node_modules/gsap" ]] || {
  echo "Exact cached GSAP was not linked" >&2
  exit 1
}

[[ "$mode" == "--runtime" ]] || {
  echo "Media pipeline static tests passed."
  exit 0
}

input="$temporary_root/input.mp4"
ffmpeg -loglevel error \
  -f lavfi -i testsrc2=s=160x284:r=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -filter_complex "[1:a]volume=0:enable='between(t,0.6,1.4)+between(t,1.7,2)'[audio]" \
  -map 0:v -map "[audio]" -t 2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$input"

transcript_fixture="$temporary_root/source-transcript.json"
jq -n '{
  segments: [{
    id: "segment-001",
    words: [
      {id:"segment-001:word-001",text:"Windows",start:0,end:0.6},
      {id:"segment-001:word-002",text:"继续",start:1.4,end:1.7}
    ]
  }]
}' > "$transcript_fixture"
seed_trim_job() {
  local target="$1"
  mkdir -p "$target/input" "$target/state" "$target/roughcut" "$target/checkpoints/diagnostics"
  cp "$input" "$target/input/source.mp4"
  cp "$transcript_fixture" "$target/state/transcript.json"
  printf '{"sourceVideo":"input/source.mp4"}\n' > "$target/state/project.json"
}

trim_job="$temporary_root/trim-job"
seed_trim_job "$trim_job"
cp "$plan" "$trim_job/state/trim-plan.json"
output="$trim_job/roughcut/a-roll.mp4"
bash "$repository_root/scripts/apply-trim-plan.sh" "$trim_job/input/source.mp4" "$trim_job/state/trim-plan.json" "$output" >/dev/null 2>&1
jq '.seams = [{"pictureAudited":true}] | .verification = {"forged":true}' \
  "$trim_job/state/trim-plan.json" > "$trim_job/state/trim-plan.json.tmp"
mv "$trim_job/state/trim-plan.json.tmp" "$trim_job/state/trim-plan.json"
node "$repository_root/scripts/finalize-trim-plan.mjs" "$trim_job/state/trim-plan.json" "$output" >/dev/null
node "$repository_root/scripts/check-trim-plan.mjs" "$trim_job/state/trim-plan.json" --require-audit --media "$output" >/dev/null
refinalized_plan="$trim_job/state/refinalized-plan.json"
jq '.remove[0].reason = "updated reading reset decision"' "$trim_job/state/trim-plan.json" > "$refinalized_plan"
node "$repository_root/scripts/check-trim-plan.mjs" "$refinalized_plan" >/dev/null
finalized_sha="$(shasum -a 256 "$trim_job/state/trim-plan.json" | awk '{print $1}')"
node "$repository_root/scripts/finalize-trim-plan.mjs" "$trim_job/state/trim-plan.json" "$output" >/dev/null
[[ "$(shasum -a 256 "$trim_job/state/trim-plan.json" | awk '{print $1}')" == "$finalized_sha" ]] || {
  echo "Trim finalization is not deterministic" >&2
  exit 1
}
duration="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$output")"
awk "BEGIN { exit !($duration > 1.28 && $duration < 1.34) }" || {
  echo "Trimmed media duration is incorrect: $duration" >&2
  exit 1
}
[[ -n "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$output")" ]] || {
  echo "Trimmed media lost audio" >&2
  exit 1
}
jq -e '
  .schemaVersion == 2
  and .verification.sourceMedia.sha256
  and .verification.roughCutMedia.sha256
  and .verification.sourceTranscript.sha256
  and .seams[0].lexical.outgoingWord.text == "Windows"
  and .seams[0].lexical.outgoingHandleFrames >= .seams[0].handles.requiredOutgoingFrames
  and (.seams[0].acoustic.outgoingBoundaryFrames | length) == 3
  and (.seams[0].acoustic.incomingBoundaryFrames | length) == 3
  and .seams[0].handles.outgoingFrames >= .seams[0].handles.requiredOutgoingFrames
  and .seams[0].handles.incomingFrames >= .seams[0].handles.requiredIncomingFrames
  and .seams[0].handles.requiredOutgoingFrames == 1
  and .seams[0].handles.requiredIncomingFrames == 1
  and .seams[0].handles.transitionSafeFrames >= .remove[0].audioTransitionFrames
  and (.seams[0] | has("pictureAudited") | not)
  and (.seams[0] | has("audioAudited") | not)
' "$trim_job/state/trim-plan.json" >/dev/null

invalid_finalized="$trim_job/state/invalid-finalized.json"
jq '.seams[0].handles.outgoingFrames = 99' "$trim_job/state/trim-plan.json" > "$invalid_finalized"
if node "$repository_root/scripts/check-trim-plan.mjs" "$invalid_finalized" --require-audit --media "$output" >/dev/null 2>&1; then
  echo "Inconsistent derived trim evidence unexpectedly passed" >&2
  exit 1
fi
jq '.verification.sourceMedia.sha256 = ("0" * 64)' "$trim_job/state/trim-plan.json" > "$invalid_finalized"
if node "$repository_root/scripts/check-trim-plan.mjs" "$invalid_finalized" --require-audit --media "$output" >/dev/null 2>&1; then
  echo "Stale source-media binding unexpectedly passed" >&2
  exit 1
fi

active_job="$temporary_root/active-job"
seed_trim_job "$active_job"
jq '.remove[0].startFrame = 17' "$plan" > "$active_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$active_job/input/source.mp4" "$active_job/state/trim-plan.json" "$active_job/roughcut/a-roll.mp4" >/dev/null 2>&1
if node "$repository_root/scripts/finalize-trim-plan.mjs" "$active_job/state/trim-plan.json" "$active_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Active-audio trim unexpectedly finalized" >&2
  exit 1
fi

boundary_job="$temporary_root/boundary-job"
seed_trim_job "$boundary_job"
jq '.remove[0].startFrame = 19' "$plan" > "$boundary_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$boundary_job/input/source.mp4" \
  "$boundary_job/state/trim-plan.json" "$boundary_job/roughcut/a-roll.mp4" >/dev/null 2>&1
if node "$repository_root/scripts/finalize-trim-plan.mjs" "$boundary_job/state/trim-plan.json" \
  "$boundary_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Cut placed on the outgoing acoustic boundary unexpectedly finalized" >&2
  exit 1
fi

lexical_job="$temporary_root/lexical-job"
seed_trim_job "$lexical_job"
jq '.segments[0].words[0].end = (20 / 30)' "$transcript_fixture" > "$lexical_job/state/transcript.json"
cp "$plan" "$lexical_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$lexical_job/input/source.mp4" \
  "$lexical_job/state/trim-plan.json" "$lexical_job/roughcut/a-roll.mp4" >/dev/null 2>&1
if node "$repository_root/scripts/finalize-trim-plan.mjs" "$lexical_job/state/trim-plan.json" \
  "$lexical_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Cut touching the end of transcript word Windows unexpectedly finalized" >&2
  exit 1
fi

head_job="$temporary_root/head-job"
seed_trim_job "$head_job"
jq '.remove[0].startFrame = 0 | .remove[0].endFrame = 41 | .remove[0].classification = "false-start"' \
  "$plan" > "$head_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$head_job/input/source.mp4" \
  "$head_job/state/trim-plan.json" "$head_job/roughcut/a-roll.mp4" >/dev/null 2>&1
node "$repository_root/scripts/finalize-trim-plan.mjs" "$head_job/state/trim-plan.json" \
  "$head_job/roughcut/a-roll.mp4" >/dev/null
jq -e '.seams[0].kind == "head" and .seams[0].handles.requiredOutgoingFrames == 0' \
  "$head_job/state/trim-plan.json" >/dev/null

tail_job="$temporary_root/tail-job"
seed_trim_job "$tail_job"
jq '.remove[0].startFrame = 53 | .remove[0].endFrame = 60 | .remove[0].classification = "body-reset"' \
  "$plan" > "$tail_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$tail_job/input/source.mp4" \
  "$tail_job/state/trim-plan.json" "$tail_job/roughcut/a-roll.mp4" >/dev/null 2>&1
node "$repository_root/scripts/finalize-trim-plan.mjs" "$tail_job/state/trim-plan.json" \
  "$tail_job/roughcut/a-roll.mp4" >/dev/null
jq -e '.seams[0].kind == "tail" and .seams[0].handles.requiredIncomingFrames == 0' \
  "$tail_job/state/trim-plan.json" >/dev/null

transition_job="$temporary_root/transition-job"
seed_trim_job "$transition_job"
jq '.remove[0].classification = "natural-pause" | .remove[0].audioTransitionFrames = 1' \
  "$plan" > "$transition_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$transition_job/input/source.mp4" \
  "$transition_job/state/trim-plan.json" "$transition_job/roughcut/a-roll.mp4" >/dev/null 2>&1
node "$repository_root/scripts/finalize-trim-plan.mjs" "$transition_job/state/trim-plan.json" \
  "$transition_job/roughcut/a-roll.mp4" >/dev/null
jq '.remove[0].classification = "natural-pause" | .remove[0].audioTransitionFrames = 2' \
  "$plan" > "$transition_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$transition_job/input/source.mp4" \
  "$transition_job/state/trim-plan.json" "$transition_job/roughcut/a-roll.mp4" >/dev/null 2>&1
if node "$repository_root/scripts/finalize-trim-plan.mjs" "$transition_job/state/trim-plan.json" \
  "$transition_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Transition longer than the incoming speech handle unexpectedly finalized" >&2
  exit 1
fi
jq '.remove[0].startFrame = 41 | .remove[0].endFrame = 54 | .remove[0].audioTransitionFrames = 2' \
  "$plan" > "$transition_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$transition_job/input/source.mp4" \
  "$transition_job/state/trim-plan.json" "$transition_job/roughcut/a-roll.mp4" >/dev/null 2>&1
if node "$repository_root/scripts/finalize-trim-plan.mjs" "$transition_job/state/trim-plan.json" \
  "$transition_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Transition that restores active removed audio unexpectedly finalized" >&2
  exit 1
fi

natural_job="$temporary_root/natural-job"
seed_trim_job "$natural_job"
jq '.remove[0].classification = "natural-pause" | .remove[0].endFrame = 37' "$plan" > "$natural_job/state/trim-plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$natural_job/input/source.mp4" "$natural_job/state/trim-plan.json" "$natural_job/roughcut/a-roll.mp4" >/dev/null 2>&1
if node "$repository_root/scripts/finalize-trim-plan.mjs" "$natural_job/state/trim-plan.json" "$natural_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Long natural pause unexpectedly passed without diagnostic evidence" >&2
  exit 1
fi
diagnostic_path="$(node "$repository_root/scripts/inspect-media-window.mjs" \
  "$natural_job" roughcut/a-roll.mp4 0.4 1.1 --frames 8 --label seam-001 2>/dev/null)"
jq -e '
  .kind == "filmstrip-waveform"
  and .media.path == "roughcut/a-roll.mp4"
  and .media.sha256
  and .image.sha256
  and (.frameTimes | length) == 8
' "$natural_job/$diagnostic_path" >/dev/null
jq --arg path "$diagnostic_path" \
  '.remove[0].diagnostic = {path:$path,finding:"Eye contact and posture remain continuous through the retained pause."}' \
  "$natural_job/state/trim-plan.json" > "$natural_job/state/trim-plan.json.tmp"
mv "$natural_job/state/trim-plan.json.tmp" "$natural_job/state/trim-plan.json"
node "$repository_root/scripts/finalize-trim-plan.mjs" "$natural_job/state/trim-plan.json" "$natural_job/roughcut/a-roll.mp4" >/dev/null
node "$repository_root/scripts/check-trim-plan.mjs" "$natural_job/state/trim-plan.json" \
  --require-audit --media "$natural_job/roughcut/a-roll.mp4" >/dev/null
jq '.window = {start:1.2,end:1.8}' "$natural_job/$diagnostic_path" > "$natural_job/$diagnostic_path.tmp"
mv "$natural_job/$diagnostic_path.tmp" "$natural_job/$diagnostic_path"
if node "$repository_root/scripts/check-trim-plan.mjs" "$natural_job/state/trim-plan.json" \
  --require-audit --media "$natural_job/roughcut/a-roll.mp4" >/dev/null 2>&1; then
  echo "Diagnostic outside the seam window unexpectedly passed" >&2
  exit 1
fi

job="$temporary_root/job"
"$repository_root/scripts/scaffold-project.sh" "$job" "$input" review subtitles >/dev/null
for version in 1 2 3; do
  export_path="$temporary_root/chatcut-$version.mp4"
  cp "$input" "$export_path"
  node "$repository_root/scripts/promote-job-media.mjs" "$job" roughcut "$export_path" --consume-source >/dev/null
  [[ ! -e "$export_path" ]] || {
    echo "Consumed ChatCut export still exists" >&2
    exit 1
  }
done
[[ "$(find "$job/roughcut" -type f -name '*.mp4' | wc -l | tr -d ' ')" == "1" ]] || {
  echo "Rough-cut promotion retained stale media" >&2
  exit 1
}
node -e 'const fs=require("fs"); if(fs.statSync(process.argv[1]).ino!==fs.statSync(process.argv[2]).ino) process.exit(1)' \
  "$job/roughcut/a-roll.mp4" "$job/hyperframes/assets/input-video.mp4" || {
    echo "HyperFrames input did not reuse the rough cut" >&2
    exit 1
  }

known_good="$(shasum -a 256 "$job/roughcut/a-roll.mp4" | awk '{print $1}')"
printf 'invalid media\n' > "$temporary_root/invalid.mp4"
if node "$repository_root/scripts/promote-job-media.mjs" "$job" roughcut "$temporary_root/invalid.mp4" >/dev/null 2>&1; then
  echo "Invalid replacement media unexpectedly passed" >&2
  exit 1
fi
[[ "$(shasum -a 256 "$job/roughcut/a-roll.mp4" | awk '{print $1}')" == "$known_good" ]] || {
  echo "Failed replacement destroyed the last known-good rough cut" >&2
  exit 1
}

escape_job="$temporary_root/escape-job"
"$repository_root/scripts/scaffold-project.sh" "$escape_job" "$input" review subtitles >/dev/null
escape_target="$temporary_root/escaped-roughcut"
mkdir "$escape_target"
rm -rf "$escape_job/roughcut"
ln -s "$escape_target" "$escape_job/roughcut"
if node "$repository_root/scripts/promote-job-media.mjs" "$escape_job" roughcut "$input" >/dev/null 2>&1; then
  echo "Symlinked rough-cut directory unexpectedly accepted media" >&2
  exit 1
fi
[[ ! -e "$escape_target/a-roll.mp4" ]] || {
  echo "Media escaped the job directory" >&2
  exit 1
}

echo "Media pipeline runtime tests passed."
