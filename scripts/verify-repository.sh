#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
verification_mode="${1:---static}"
if [[ "$verification_mode" != "--static" && "$verification_mode" != "--runtime" ]]; then
  echo "Usage: scripts/verify-repository.sh [--static|--runtime]" >&2
  exit 64
fi
runtime_font="${CUT_MOTION_FONT:-${MOTIONSCRIPT_FONT:-}}"
if [[ "$verification_mode" == "--runtime" && (! -f "$runtime_font" || ! -r "$runtime_font") ]]; then
  echo "Runtime verification requires CUT_MOTION_FONT=/absolute/path/to/smiley-sans-oblique.woff2" >&2
  exit 66
fi

sha256_file() {
  node -e 'const fs=require("fs"),crypto=require("crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

while IFS= read -r json_file; do
  jq -e . "$json_file" >/dev/null
done < <(find "$repository_root" -type d \( -name node_modules -o -name .git -o -name .hyperframes \) -prune -o -name '*.json' -type f -print)

while IFS= read -r shell_file; do
  bash -n "$shell_file"
done < <(find "$repository_root/scripts" -name '*.sh' -type f)

bash "$repository_root/scripts/check-environment.sh" check

dependency_cache_smoke="$(mktemp -d)"
dependency_job_smoke="$(mktemp -d)"
mkdir -p \
  "$dependency_cache_smoke/_npx/test/node_modules/hyperframes/dist" \
  "$dependency_cache_smoke/_npx/test/node_modules/gsap/dist" \
  "$dependency_job_smoke/hyperframes/assets"
printf '{"version":"0.7.60","bin":{"hyperframes":"dist/cli.js"}}\n' > "$dependency_cache_smoke/_npx/test/node_modules/hyperframes/package.json"
printf '#!/usr/bin/env node\n' > "$dependency_cache_smoke/_npx/test/node_modules/hyperframes/dist/cli.js"
printf '{"version":"3.13.0"}\n' > "$dependency_cache_smoke/_npx/test/node_modules/gsap/package.json"
printf 'gsap cache fixture\n' > "$dependency_cache_smoke/_npx/test/node_modules/gsap/dist/gsap.min.js"
cp "$repository_root/templates/hyperframes/package.json" "$dependency_job_smoke/hyperframes/package.json"
npm_config_cache="$dependency_cache_smoke" \
  bash "$repository_root/scripts/check-environment.sh" install-job "$dependency_job_smoke" --yes >/dev/null
[[ -L "$dependency_job_smoke/hyperframes/node_modules/hyperframes" ]] || { echo "HyperFrames cache was not linked" >&2; exit 1; }
[[ -L "$dependency_job_smoke/hyperframes/node_modules/gsap" ]] || { echo "GSAP cache was not linked" >&2; exit 1; }
grep -q 'gsap cache fixture' "$dependency_job_smoke/hyperframes/assets/gsap.min.js" || { echo "Cached GSAP asset was not prepared" >&2; exit 1; }
rm -rf "$dependency_cache_smoke" "$dependency_job_smoke"

while IFS= read -r module_file; do
  node --check "$module_file"
done < <(find "$repository_root/scripts" -name '*.mjs' -type f)

trim_audit_file="$(mktemp)"
cat > "$trim_audit_file" <<'EOF'
{
  "source": "roughcut/a-roll.mp4",
  "fps": 30,
  "remove": [{"start":10,"end":11,"reason":"manual","confidence":0.9}],
  "trimProfile": {
    "name": "tight-talking-head",
    "acousticThresholdsDb": [-30, -35, -40],
    "outgoingHandleSeconds": 0.02,
    "incomingHandleSeconds": 0.05,
    "audioTransitionFrames": 2,
    "maximumResidualSilenceMs": 80
  },
  "seams": [{
    "id": "seam-001",
    "classification": "reset-removed",
    "reason": "visible reading reset after spoken phrase",
    "semanticEvidence": "the phrase is a duplicate take",
    "visualEvidence": "gaze leaves lens before restart",
    "confidence": 0.9,
    "acousticBoundaryFrames": [300, 301, 302],
    "appliedFrame": 301,
    "audioTransitionFrames": 2,
    "pictureAudited": true,
    "audioAudited": true
  }],
  "verification": {
    "everySeamAudited": true,
    "contiguous": true
  }
}
EOF
node "$repository_root/scripts/check-trim-plan.mjs" "$trim_audit_file" --require-audit
invalid_trim_audit_file="$(mktemp)"
jq 'del(.seams[0].audioAudited)' "$trim_audit_file" > "$invalid_trim_audit_file"
if node "$repository_root/scripts/check-trim-plan.mjs" "$invalid_trim_audit_file" --require-audit >/dev/null 2>&1; then
  echo "Incomplete seam audit unexpectedly passed" >&2
  exit 1
fi
invalid_trim_range_file="$(mktemp)"
jq '.remove = [{"start":2,"end":3},{"start":1,"end":1.5}]' "$trim_audit_file" > "$invalid_trim_range_file"
if node "$repository_root/scripts/check-trim-plan.mjs" "$invalid_trim_range_file" >/dev/null 2>&1; then
  echo "Out-of-order trim ranges unexpectedly passed" >&2
  exit 1
fi
rm -f "$trim_audit_file" "$invalid_trim_audit_file" "$invalid_trim_range_file"

trim_smoke_directory="$(mktemp -d)"
ffmpeg -loglevel error -f lavfi -i testsrc2=s=160x284:r=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$trim_smoke_directory/input.mp4"
printf '{"source":"input.mp4","fps":30,"remove":[{"start":0.7,"end":1.2}],"audioTransitionFrames":0}\n' > "$trim_smoke_directory/plan.json"
bash "$repository_root/scripts/apply-trim-plan.sh" "$trim_smoke_directory/input.mp4" "$trim_smoke_directory/plan.json" "$trim_smoke_directory/output.mp4" >/dev/null 2>&1
trimmed_duration="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$trim_smoke_directory/output.mp4")"
awk "BEGIN { exit !($trimmed_duration > 1.4 && $trimmed_duration < 1.6) }" || { echo "Trimmed media duration is incorrect: $trimmed_duration" >&2; exit 1; }
[[ "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$trim_smoke_directory/output.mp4")" != "" ]] || { echo "Trimmed media lost audio" >&2; exit 1; }
ffmpeg -loglevel error \
  -f lavfi -i sine=frequency=440:sample_rate=48000:duration=0.95 \
  -f lavfi -i anullsrc=r=48000:cl=mono:d=0.1 \
  -f lavfi -i sine=frequency=440:sample_rate=48000:duration=0.95 \
  -filter_complex '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]' -map '[out]' "$trim_smoke_directory/residual.wav"
cat > "$trim_smoke_directory/residual-plan.json" <<'EOF'
{
  "source": "residual.wav",
  "fps": 30,
  "remove": [{"start":1,"end":1.1,"reason":"manual","confidence":1}],
  "trimProfile": {
    "name": "tight-talking-head",
    "acousticThresholdsDb": [-30, -35, -40],
    "outgoingHandleSeconds": 0.02,
    "incomingHandleSeconds": 0.05,
    "audioTransitionFrames": 2,
    "maximumResidualSilenceMs": 80
  },
  "seams": [{
    "id": "seam-residual",
    "classification": "reading-reset",
    "reason": "synthetic removable pause",
    "semanticEvidence": "synthetic fixture",
    "visualEvidence": "synthetic fixture",
    "confidence": 1,
    "acousticBoundaryFrames": [29, 30, 31],
    "appliedFrame": 30,
    "outputTime": 1,
    "audioTransitionFrames": 2,
    "pictureAudited": true,
    "audioAudited": true
  }],
  "verification": { "everySeamAudited": true, "contiguous": true }
}
EOF
if node "$repository_root/scripts/audit-roughcut-seams.mjs" "$trim_smoke_directory/residual-plan.json" "$trim_smoke_directory/residual.wav" >/dev/null 2>&1; then
  echo "A removable 100ms residual pause unexpectedly passed" >&2
  exit 1
fi
for mutation in \
  '.seams[0].maximumResidualSilenceMs = 1000' \
  '.seams[0].outputTime = 0.5' \
  '.seams[0].classification = "unknown"'; do
  bypass_plan="$(mktemp)"
  jq "$mutation" "$trim_smoke_directory/residual-plan.json" > "$bypass_plan"
  if node "$repository_root/scripts/audit-roughcut-seams.mjs" "$bypass_plan" "$trim_smoke_directory/residual.wav" >/dev/null 2>&1; then
    echo "Residual-pause audit bypass unexpectedly passed: $mutation" >&2
    exit 1
  fi
  rm -f "$bypass_plan"
done
missing_seam_plan="$(mktemp)"
jq '.seams = []' "$trim_smoke_directory/residual-plan.json" > "$missing_seam_plan"
if node "$repository_root/scripts/check-trim-plan.mjs" "$missing_seam_plan" --require-audit >/dev/null 2>&1; then
  echo "Removed range without a seam unexpectedly passed" >&2
  exit 1
fi
rm -f "$missing_seam_plan"
jq '.seams[0].classification = "natural-pause"' "$trim_smoke_directory/residual-plan.json" > "$trim_smoke_directory/natural-plan.json"
node "$repository_root/scripts/audit-roughcut-seams.mjs" "$trim_smoke_directory/natural-plan.json" "$trim_smoke_directory/residual.wav" >/dev/null
node "$repository_root/scripts/check-trim-plan.mjs" "$trim_smoke_directory/natural-plan.json" --require-audit --media "$trim_smoke_directory/residual.wav" >/dev/null
printf '{"duration":10,"start":1,"end":3,"audioAnchorTime":4,"microEvents":[{"time":8}]}\n' > "$trim_smoke_directory/times.json"
bash "$repository_root/scripts/shift-timestamps.sh" "$trim_smoke_directory/times.json" 2 5 "$trim_smoke_directory/shifted.json"
jq -e '.duration == 7 and .start == 1 and .end == 2 and .audioAnchorTime == 2 and .microEvents[0].time == 5' "$trim_smoke_directory/shifted.json" >/dev/null
media_job="$trim_smoke_directory/media-job"
"$repository_root/scripts/scaffold-project.sh" "$media_job" "$trim_smoke_directory/input.mp4" review subtitles >/dev/null
for version in 1 2 3; do
  cp "$trim_smoke_directory/input.mp4" "$trim_smoke_directory/chatcut-$version.mp4"
  node "$repository_root/scripts/promote-job-media.mjs" "$media_job" roughcut "$trim_smoke_directory/chatcut-$version.mp4" --consume-source >/dev/null
  [[ ! -e "$trim_smoke_directory/chatcut-$version.mp4" ]] || { echo "Consumed ChatCut export still exists" >&2; exit 1; }
done
[[ "$(find "$media_job/roughcut" -type f -name '*.mp4' | wc -l | tr -d ' ')" == "1" ]] || { echo "Roughcut directory contains multiple media versions" >&2; exit 1; }
node -e 'const fs=require("fs"); if(fs.statSync(process.argv[1]).ino!==fs.statSync(process.argv[2]).ino) process.exit(1)' \
  "$media_job/roughcut/a-roll.mp4" "$media_job/hyperframes/assets/input-video.mp4" \
  || { echo "HyperFrames input did not reuse the rough cut through a hard link" >&2; exit 1; }
diagnostic_path="$(node "$repository_root/scripts/inspect-media-window.mjs" "$media_job" roughcut/a-roll.mp4 0.2 1.8 --frames 6 --label seam-smoke 2>/dev/null)"
[[ -f "$media_job/$diagnostic_path" ]] || { echo "Filmstrip-waveform diagnostic was not created" >&2; exit 1; }
diagnostic_size="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$media_job/$diagnostic_path")"
[[ "$diagnostic_size" == "1440x400" ]] || { echo "Diagnostic dimensions are incorrect: $diagnostic_size" >&2; exit 1; }
if node "$repository_root/scripts/inspect-media-window.mjs" "$media_job" ../input.mp4 0 1 >/dev/null 2>&1; then
  echo "Diagnostic unexpectedly accepted media outside the job" >&2
  exit 1
fi
if node "$repository_root/scripts/inspect-media-window.mjs" "$media_job" roughcut/a-roll.mp4 0 9 >/dev/null 2>&1; then
  echo "Diagnostic unexpectedly accepted an oversized scan window" >&2
  exit 1
fi
known_good_sha="$(sha256_file "$media_job/roughcut/a-roll.mp4")"
printf 'invalid media\n' > "$trim_smoke_directory/invalid-export.mp4"
if node "$repository_root/scripts/promote-job-media.mjs" "$media_job" roughcut "$trim_smoke_directory/invalid-export.mp4" --consume-source >/dev/null 2>&1; then
  echo "Invalid replacement media unexpectedly passed" >&2
  exit 1
fi
[[ "$(sha256_file "$media_job/roughcut/a-roll.mp4")" == "$known_good_sha" ]] || { echo "Failed replacement destroyed the last known-good rough cut" >&2; exit 1; }
immutable_source="$media_job/$(jq -r '.sourceVideo' "$media_job/state/project.json")"
if node "$repository_root/scripts/promote-job-media.mjs" "$media_job" roughcut "$immutable_source" --consume-source >/dev/null 2>&1; then
  echo "Immutable input media was unexpectedly consumed" >&2
  exit 1
fi
[[ -f "$immutable_source" ]] || { echo "Immutable input media was deleted" >&2; exit 1; }
escape_job="$trim_smoke_directory/escape-job"
"$repository_root/scripts/scaffold-project.sh" "$escape_job" "$trim_smoke_directory/input.mp4" review subtitles >/dev/null
escape_target="$trim_smoke_directory/escaped-roughcut"
mkdir -p "$escape_target"
rm -rf "$escape_job/roughcut"
ln -s "$escape_target" "$escape_job/roughcut"
if node "$repository_root/scripts/promote-job-media.mjs" "$escape_job" roughcut "$trim_smoke_directory/input.mp4" >/dev/null 2>&1; then
  echo "Symlinked roughcut directory unexpectedly accepted media" >&2
  exit 1
fi
[[ ! -e "$escape_target/a-roll.mp4" ]] || { echo "Media escaped the job directory" >&2; exit 1; }
rm -rf "$trim_smoke_directory"

node "$repository_root/scripts/check-visual-plan.mjs" \
  "$repository_root/examples/beat-map.example.json" \
  "$repository_root/examples/transcript.example.json" \
  "$repository_root/assets/design-system.default.json"

node "$repository_root/scripts/check-visual-plan.mjs" \
  "$repository_root/examples/beat-map.subtitles.example.json" \
  "$repository_root/examples/transcript.example.json" \
  "$repository_root/assets/design-system.default.json"
node "$repository_root/scripts/check-information-value.mjs" \
  "$repository_root/templates/hyperframes/index.html" \
  "$repository_root/assets/design-system.default.json"
node "$repository_root/scripts/check-layout-constraints.mjs" \
  "$repository_root/templates/hyperframes/index.html" \
  "$repository_root/assets/design-system.default.json"

invalid_topology_map="$(mktemp)"
jq '.beats[0].semanticTopology = "convergence"' "$repository_root/examples/beat-map.example.json" > "$invalid_topology_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$invalid_topology_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Invalid convergence topology unexpectedly passed" >&2
  exit 1
fi
delayed_entry_map="$(mktemp)"
jq '.beats[0].microEvents[0].time = 0.8' "$repository_root/examples/beat-map.example.json" > "$delayed_entry_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$delayed_entry_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Delayed first meaningful event unexpectedly passed" >&2
  exit 1
fi
skewed_reveal_map="$(mktemp)"
jq '.beats[0].microEvents[1].time = 0.6' "$repository_root/examples/beat-map.subtitles.example.json" > "$skewed_reveal_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$skewed_reveal_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Uncoordinated reveal group unexpectedly passed" >&2
  exit 1
fi
repeated_signature_map="$(mktemp)"
jq '.beats[1].semanticTopology = .beats[0].semanticTopology
  | .beats[1].visualReference = .beats[0].visualReference
  | .beats[1].primaryFlowAxis = .beats[0].primaryFlowAxis
  | .beats[1].motionFamily = .beats[0].motionFamily
  | .beats[1].transitionFamily = .beats[0].transitionFamily
  | .beats[1].visualStyle = .beats[0].visualStyle
  | .beats[1].layout.primaryOccupancyRatio = .beats[0].layout.primaryOccupancyRatio
  | .beats[].reuseGroup = null
  | .beats[].reuseReason = null' "$repository_root/examples/beat-map.example.json" > "$repeated_signature_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$repeated_signature_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Undeclared repeated visual signature unexpectedly passed" >&2
  exit 1
fi
invalid_surface_file="$(mktemp).html"
sed 's/data-border-policy="none"/data-border-policy="solid"/' "$repository_root/templates/hyperframes/index.html" > "$invalid_surface_file"
if node "$repository_root/scripts/check-layout-constraints.mjs" "$invalid_surface_file" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Outlined generic motion container unexpectedly passed" >&2
  exit 1
fi
invalid_label_file="$(mktemp).html"
sed 's#</body>#<div class="status-badge">TOOL 01</div></body>#' "$repository_root/templates/hyperframes/index.html" > "$invalid_label_file"
if node "$repository_root/scripts/check-layout-constraints.mjs" "$invalid_label_file" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Unannotated decorative label unexpectedly passed" >&2
  exit 1
fi
bold_caption_file="$(mktemp).html"
sed 's#</head>#<style>.motion-caption-line { font-weight:700!important; font-synthesis:none; }</style></head>#' "$repository_root/templates/hyperframes/index.html" > "$bold_caption_file"
if node "$repository_root/scripts/check-layout-constraints.mjs" "$bold_caption_file" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Bold caption override unexpectedly passed" >&2
  exit 1
fi
rm -f "$invalid_topology_map" "$delayed_entry_map" "$skewed_reveal_map" "$repeated_signature_map" "$invalid_surface_file" "$invalid_label_file" "$bold_caption_file"
node "$repository_root/scripts/test-workflow-contracts.mjs"

invalid_information_file="$(mktemp).html"
printf '<style>.micro { font-size: 24px; }</style><div class="micro">真人画面</div>\n' > "$invalid_information_file"
if node "$repository_root/scripts/check-information-value.mjs" "$invalid_information_file" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Invalid micro-label unexpectedly passed information-value validation" >&2
  exit 1
fi
rm -f "$invalid_information_file"

caption_smoke_file="$(mktemp)"
node "$repository_root/scripts/build-captions.mjs" \
  "$repository_root/examples/chatcut-caption-pages.example.json" \
  "$repository_root/assets/design-system.default.json" \
  "$caption_smoke_file"
node "$repository_root/scripts/check-captions.mjs" \
  "$caption_smoke_file" \
  "$repository_root/examples/chatcut-caption-pages.example.json" \
  "$repository_root/assets/design-system.default.json"

caption_smoke_html="$(mktemp)"
cp "$repository_root/templates/hyperframes/index.html" "$caption_smoke_html"
node "$repository_root/scripts/install-captions.mjs" "$caption_smoke_file" "$caption_smoke_html"
node "$repository_root/scripts/install-captions.mjs" "$caption_smoke_file" "$caption_smoke_html"
node "$repository_root/scripts/check-caption-layer.mjs" "$caption_smoke_file" "$caption_smoke_html"
rm -f "$caption_smoke_html"

invalid_caption_file="$(mktemp)"
jq '.style.fontWeight = 700' "$caption_smoke_file" > "$invalid_caption_file"
if node "$repository_root/scripts/check-captions.mjs" "$invalid_caption_file" "$repository_root/examples/chatcut-caption-pages.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Bold caption style unexpectedly passed" >&2
  exit 1
fi
rm -f "$invalid_caption_file"
rm -f "$caption_smoke_file"

invalid_subtitle_map="$(mktemp)"
jq '.beats[0].text = "看看这些特效"' "$repository_root/examples/beat-map.subtitles.example.json" > "$invalid_subtitle_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$invalid_subtitle_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Subtitle motion that duplicates caption copy unexpectedly passed" >&2
  exit 1
fi
rm -f "$invalid_subtitle_map"

caption_only_subtitle_map="$(mktemp)"
jq '.beats |= map(.mgScope = "none" | .recipe = "caption-only" | .components = [] | .microEvents = [] | .axis = "A")' "$repository_root/examples/beat-map.subtitles.example.json" > "$caption_only_subtitle_map"
node "$repository_root/scripts/check-visual-plan.mjs" "$caption_only_subtitle_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json"
rm -f "$caption_only_subtitle_map"

global_subtitle_map="$(mktemp)"
jq '.beats[0].mgScope = "global"' "$repository_root/examples/beat-map.subtitles.example.json" > "$global_subtitle_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$global_subtitle_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Global subtitle MG unexpectedly passed visual-plan validation" >&2
  exit 1
fi
rm -f "$global_subtitle_map"

missing_cognition_gap_map="$(mktemp)"
jq 'del(.beats[0].viewerQuestion)' "$repository_root/examples/beat-map.subtitles.example.json" > "$missing_cognition_gap_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$missing_cognition_gap_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Subtitle MG without a viewer cognition gap unexpectedly passed" >&2
  exit 1
fi
rm -f "$missing_cognition_gap_map"

missing_on_screen_copy_map="$(mktemp)"
jq 'del(.beats[0].onScreenCopy)' "$repository_root/examples/beat-map.subtitles.example.json" > "$missing_on_screen_copy_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$missing_on_screen_copy_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "Subtitle MG without exact on-screen copy unexpectedly passed" >&2
  exit 1
fi
rm -f "$missing_on_screen_copy_map"

invalid_attention_cost_map="$(mktemp)"
jq '.beats[0].attentionCost = "high" | .beats[0].axis = "A"' "$repository_root/examples/beat-map.subtitles.example.json" > "$invalid_attention_cost_map"
if node "$repository_root/scripts/check-visual-plan.mjs" "$invalid_attention_cost_map" "$repository_root/examples/transcript.example.json" "$repository_root/assets/design-system.default.json" >/dev/null 2>&1; then
  echo "High-cost A-axis subtitle MG unexpectedly passed" >&2
  exit 1
fi
rm -f "$invalid_attention_cost_map"

if [[ "$verification_mode" == "--runtime" ]]; then
state_smoke_directory="$(mktemp -d)"
mkdir -p "$state_smoke_directory/input" "$state_smoke_directory/state" "$state_smoke_directory/roughcut" "$state_smoke_directory/docs" "$state_smoke_directory/captions" "$state_smoke_directory/previews" "$state_smoke_directory/hyperframes" "$state_smoke_directory/checkpoints" "$state_smoke_directory/logs" "$state_smoke_directory/output"
cp -R "$repository_root/templates/hyperframes/." "$state_smoke_directory/hyperframes"
mkdir -p "$state_smoke_directory/hyperframes/assets/fonts"
cp "$runtime_font" "$state_smoke_directory/hyperframes/assets/fonts/smiley-sans-oblique.woff2"
bash "$repository_root/scripts/check-environment.sh" install-job "$state_smoke_directory" --yes >/dev/null
cp "$repository_root/templates/job/workflow.json" "$state_smoke_directory/state/workflow.json"
cp "$repository_root/motion-project.example.json" "$state_smoke_directory/state/project.json"
cp "$repository_root/examples/beat-map.subtitles.example.json" "$state_smoke_directory/state/beat-map.json"
cp "$repository_root/examples/transcript.example.json" "$state_smoke_directory/state/transcript.json"
cp "$repository_root/assets/design-system.default.json" "$state_smoke_directory/state/design-system.json"
cp "$repository_root/templates/job/visual-sample-report.json" "$state_smoke_directory/state/visual-sample-report.json"
cp "$repository_root/templates/job/qa-report.json" "$state_smoke_directory/state/qa-report.json"
smoke_video="$(mktemp).mp4"
ffmpeg -loglevel error -f lavfi -i testsrc2=s=160x284:r=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3.2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$smoke_video"
cp "$smoke_video" "$state_smoke_directory/input/source.mov"
cp "$smoke_video" "$state_smoke_directory/roughcut/a-roll.mp4"
cp "$smoke_video" "$state_smoke_directory/roughcut/a-roll-trimmed.mp4"
cp "$smoke_video" "$state_smoke_directory/previews/visual-sample.mp4"
cp "$smoke_video" "$state_smoke_directory/previews/final-preview.mp4"
cp "$smoke_video" "$state_smoke_directory/output/final.mp4"
cp "$smoke_video" "$state_smoke_directory/hyperframes/assets/input-video.mp4"
mkdir -p "$state_smoke_directory/hyperframes/visual-sample"
cp "$state_smoke_directory/hyperframes/index.html" "$state_smoke_directory/hyperframes/visual-sample/index.html"
cp -R "$state_smoke_directory/hyperframes/assets" "$state_smoke_directory/hyperframes/visual-sample/assets"
cat > "$state_smoke_directory/state/trim-plan.json" <<'EOF'
{
  "source": "roughcut/a-roll.mp4",
  "fps": 30,
  "remove": [],
  "trimProfile": {
    "name": "tight-talking-head",
    "acousticThresholdsDb": [-30, -35, -40],
    "outgoingHandleSeconds": 0.02,
    "incomingHandleSeconds": 0.05,
    "audioTransitionFrames": 2,
    "maximumResidualSilenceMs": 80
  },
  "seams": [],
  "verification": {
    "everySeamAudited": true,
    "contiguous": true
  }
}
EOF
printf '# Motion Plan\n\n| Time | Audio phrase |\n| --- | --- |\n| 0–1.5 | 关键帧 / GSAP |\n| 1.5–3 | 30 FPS / 实时同步 |\n\n- Caption mode: subtitles\n' > "$state_smoke_directory/docs/motion-plan.md"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance >/dev/null
jq '[.segments | to_entries[] | {
  id: ("speech-" + ((.key + 1) | tostring)),
  type: "speech-only",
  segmentId: .value.id,
  start: .value.start,
  end: .value.end,
  referenceText: null,
  heardText: .value.text,
  resolution: "accepted-speech",
  releaseImpact: true,
  confidence: (.value.confidence // 1),
  evidence: {audioChecked:true, supportsReference:false, note:"Fixture audio reviewed"}
}]' "$state_smoke_directory/state/transcript.json" > "$state_smoke_directory/state/reconciliation-items.json"
node "$repository_root/scripts/create-transcript-reconciliation.mjs" "$state_smoke_directory" input/source.mov "$state_smoke_directory/state/reconciliation-items.json" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact state/transcript.json >/dev/null
node "$repository_root/scripts/create-transcript-reconciliation.mjs" "$state_smoke_directory" roughcut/a-roll.mp4 "$state_smoke_directory/state/reconciliation-items.json" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact roughcut/a-roll.mp4 >/dev/null
jq -e '.currentState == "rough-cut-review" and .pendingGate == "rough-cut-review" and .gates["rough-cut-review"].artifact == "roughcut/a-roll.mp4"' "$state_smoke_directory/state/workflow.json" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" set-caption-mode subtitles --actor agent --note "Talking-head release benefits from readable captions" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" set-axis-mode a-axis-overlay --actor agent --note "No supporting B-axis media was supplied" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" approve --actor user --note approved >/dev/null
jq -e '.currentState == "motion-plan" and .captionModeAcknowledged == true and .visualAxisModeAcknowledged == true and .referenceScriptAcknowledged == true and .gates["rough-cut-review"].status == "approved" and .gates["rough-cut-review"].artifact == "roughcut/a-roll.mp4"' "$state_smoke_directory/state/workflow.json" >/dev/null
if node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact docs/motion-plan.md >/dev/null 2>&1; then
  echo "Motion-plan advancement unexpectedly bypassed creative confirmation" >&2
  exit 1
fi
cp "$repository_root/templates/job/creative-confirmation.md" "$state_smoke_directory/docs/creative-confirmation.md"
cp "$repository_root/examples/caption-plan.example.md" "$state_smoke_directory/docs/caption-plan.md"
cp "$repository_root/examples/caption-reference.example.txt" "$state_smoke_directory/captions/reference-transcript.txt"
cp "$repository_root/templates/job/caption-lexicon.json" "$state_smoke_directory/captions/caption-lexicon.json"
cp "$repository_root/examples/caption-review-plan.example.json" "$state_smoke_directory/captions/caption-review-plan.json"
jq '.storyboard.beatCount = 2 | .review.status = "ready" | .visualAxisMode = "b-axis-stage" | .captionModeDecision = {"status":"acknowledged","source":"user"}' "$repository_root/templates/job/creative-confirmation.json" > "$state_smoke_directory/state/creative-confirmation.json"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" set-axis-mode b-axis-stage --actor user --note "Approve the fixture B-axis stage" >/dev/null
node "$repository_root/scripts/build-caption-review-plan.mjs" "$state_smoke_directory" >/dev/null
invalid_state_smoke_map="$(mktemp)"
jq 'del(.beats[0].stillFrameValue)' "$state_smoke_directory/state/beat-map.json" > "$invalid_state_smoke_map"
mv "$invalid_state_smoke_map" "$state_smoke_directory/state/beat-map.json"
if node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact docs/motion-plan.md >/dev/null 2>&1; then
  echo "Motion-plan advancement unexpectedly bypassed visual-plan validation" >&2
  exit 1
fi
cp "$repository_root/examples/beat-map.subtitles.example.json" "$state_smoke_directory/state/beat-map.json"
{
  printf '\n### 运行时夹具审核内容\n\n'
  jq -r '.beats[] | [
    .id,
    .supportRole,
    .viewerQuestion,
    .removalLoss,
    .visualStyle,
    .primaryFlowAxis,
    .visualReference,
    .semanticTopology,
    .entryAnchorWordId,
    (.onScreenCopy | join(" / "))
  ] | @tsv' "$state_smoke_directory/state/beat-map.json"
} >> "$state_smoke_directory/docs/creative-confirmation.md"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact docs/motion-plan.md >/dev/null
jq -e '.currentState == "motion-plan-review" and .pendingGate == "motion-plan-review"' "$state_smoke_directory/state/workflow.json" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" set-mode auto --actor user >/dev/null
jq -e '.currentState == "visual-sample" and .captionModeAcknowledged == true and .gates["motion-plan-review"].status == "auto-approved" and .gates["motion-plan-review"].artifact == "docs/motion-plan.md"' "$state_smoke_directory/state/workflow.json" >/dev/null
black_video="$(mktemp).mp4"
ffmpeg -loglevel error -f lavfi -i color=c=black:s=160x284:r=30 -f lavfi -i anullsrc=r=48000:cl=stereo -t 3.2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$black_video"
cp "$black_video" "$state_smoke_directory/previews/visual-sample.mp4"
if black_result="$(node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact previews/visual-sample.mp4 2>&1)"; then
  echo "Black silent visual sample unexpectedly advanced" >&2
  exit 1
fi
[[ "$black_result" == *"audio is silent or unreadable"* ]] || { echo "Black sample failed for the wrong reason: $black_result" >&2; exit 1; }
cp "$smoke_video" "$state_smoke_directory/previews/visual-sample.mp4"
rm -f "$black_video"
sample_sha="$(sha256_file "$state_smoke_directory/previews/visual-sample.mp4")"
creative_package_sha="$(jq -r '.creativeConfirmationSha256' "$state_smoke_directory/state/workflow.json")"
visual_source_sha="$(sha256_file "$state_smoke_directory/hyperframes/visual-sample/index.html")"

visual_checks_file="$state_smoke_directory/state/visual-checks.fixture.json"
printf '[]\n' > "$visual_checks_file"
while read -r check_id; do
  evidence_json="$(node "$repository_root/scripts/run-validation-check.mjs" "$state_smoke_directory" visual "$check_id" previews/visual-sample.mp4 hyperframes/visual-sample/index.html)"
  next_checks="$(mktemp)"
  jq --argjson evidence "$evidence_json" \
    --arg id "$check_id" \
    '. + [{
      id:$id,
      status:"pass",
      evidence:[$evidence]
    }]' "$visual_checks_file" > "$next_checks"
  mv "$next_checks" "$visual_checks_file"
done <<EOF
typography
layout-and-safe-regions
information-value
snapshots
audio
EOF

jq --arg checked_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg sample_sha "$sample_sha" --arg source_sha "$visual_source_sha" --arg creative_sha "$creative_package_sha" --slurpfile checks "$visual_checks_file" '
  .passed = true
  | .checkedAt = $checked_at
  | .artifact = {"path":"previews/visual-sample.mp4","sha256":$sample_sha}
  | .source = {"path":"hyperframes/visual-sample/index.html","sha256":$source_sha}
  | .creativePackageSha256 = $creative_sha
  | .checks = $checks[0]
' "$repository_root/templates/job/visual-sample-report.json" > "$state_smoke_directory/state/visual-sample-report.json"
cp "$state_smoke_directory/state/visual-sample-report.json" "$state_smoke_directory/state/visual-sample-report.valid.json"
fake_command_report="$(mktemp)"
jq '.checks[0].evidence[0].command = "echo pass"' "$state_smoke_directory/state/visual-sample-report.json" > "$fake_command_report"
mv "$fake_command_report" "$state_smoke_directory/state/visual-sample-report.json"
if fake_command_result="$(node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact previews/visual-sample.mp4 2>&1)"; then
  echo "Fake validation command unexpectedly advanced" >&2
  exit 1
fi
[[ "$fake_command_result" == *"metadata is incomplete"* ]] || { echo "Fake command failed for the wrong reason: $fake_command_result" >&2; exit 1; }
cp "$state_smoke_directory/state/visual-sample-report.valid.json" "$state_smoke_directory/state/visual-sample-report.json"
self_evidence_report="$(mktemp)"
jq --arg sample_sha "$sample_sha" '
  .checks[0].evidence[0].path = "previews/visual-sample.mp4"
  | .checks[0].evidence[0].sha256 = $sample_sha
' "$state_smoke_directory/state/visual-sample-report.json" > "$self_evidence_report"
mv "$self_evidence_report" "$state_smoke_directory/state/visual-sample-report.json"
if self_evidence_result="$(node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact previews/visual-sample.mp4 2>&1)"; then
  echo "Self-referential visual-sample evidence unexpectedly advanced" >&2
  exit 1
fi
[[ "$self_evidence_result" == *"independent receipt"* ]] || { echo "Self-evidence failed for the wrong reason: $self_evidence_result" >&2; exit 1; }
mv "$state_smoke_directory/state/visual-sample-report.valid.json" "$state_smoke_directory/state/visual-sample-report.json"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact previews/visual-sample.mp4 >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact hyperframes/index.html >/dev/null
cp "$repository_root/examples/chatcut-caption-pages.example.json" "$state_smoke_directory/captions/chatcut-pages.json"
node "$repository_root/scripts/promote-caption-review-plan.mjs" "$state_smoke_directory" >/dev/null
composition_sha="$(sha256_file "$state_smoke_directory/hyperframes/index.html")"
preview_sha="$(sha256_file "$state_smoke_directory/previews/final-preview.mp4")"
qa_checks_file="$state_smoke_directory/state/qa-checks.fixture.json"
printf '[]\n' > "$qa_checks_file"
while IFS='|' read -r check_id subject_name; do
  if [[ "$subject_name" == "composition" ]]; then
    subject_path="hyperframes/index.html"
  else
    subject_path="previews/final-preview.mp4"
  fi
  evidence_json="$(node "$repository_root/scripts/run-validation-check.mjs" "$state_smoke_directory" final "$check_id" "$subject_path")"
  next_checks="$(mktemp)"
  jq --argjson evidence "$evidence_json" \
    --arg id "$check_id" \
    '. + [{
      id:$id,
      status:"pass",
      evidence:[$evidence]
    }]' "$qa_checks_file" > "$next_checks"
  mv "$next_checks" "$qa_checks_file"
done <<EOF
hyperframes|composition
font|composition
information-value|composition
layout|composition
snapshots|preview
captions|composition
audio|preview
media|preview
EOF

jq --arg checked_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg composition_sha "$composition_sha" --arg preview_sha "$preview_sha" --slurpfile checks "$qa_checks_file" '
  .passed = true
  | .checkedAt = $checked_at
  | .artifacts.composition = {"path":"hyperframes/index.html","sha256":$composition_sha}
  | .artifacts.preview = {"path":"previews/final-preview.mp4","sha256":$preview_sha}
  | .checks = $checks[0]
' "$repository_root/templates/job/qa-report.json" > "$state_smoke_directory/state/qa-report.json"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact previews/final-preview.mp4 >/dev/null
black_delivery="$(mktemp).mp4"
ffmpeg -loglevel error -f lavfi -i color=c=black:s=160x284:r=30 -f lavfi -i anullsrc=r=48000:cl=stereo -t 3.2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$black_delivery"
cp "$black_delivery" "$state_smoke_directory/output/final.mp4"
if black_delivery_result="$(node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact output/final.mp4 2>&1)"; then
  echo "Black silent final delivery unexpectedly advanced" >&2
  exit 1
fi
[[ "$black_delivery_result" == *"Final delivery audio is silent or unreadable"* ]] || { echo "Black delivery failed for the wrong reason: $black_delivery_result" >&2; exit 1; }
cp "$smoke_video" "$state_smoke_directory/output/final.mp4"
rm -f "$black_delivery"
different_delivery="$(mktemp).mp4"
ffmpeg -loglevel error -f lavfi -i color=c=red:s=160x284:r=30 -f lavfi -i sine=frequency=880:sample_rate=48000 -t 3.2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$different_delivery"
cp "$different_delivery" "$state_smoke_directory/output/final.mp4"
if different_delivery_result="$(node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact output/final.mp4 2>&1)"; then
  echo "Editorially different final delivery unexpectedly advanced" >&2
  exit 1
fi
[[ "$different_delivery_result" == *"differs from the approved preview"* ]] || { echo "Different delivery failed for the wrong reason: $different_delivery_result" >&2; exit 1; }
cp "$smoke_video" "$state_smoke_directory/output/final.mp4"
rm -f "$different_delivery"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact output/final.mp4 >/dev/null
jq -e '.currentState == "complete" and .completed == true and .gates["visual-sample-review"].status == "auto-approved" and .gates["final-preview"].status == "auto-approved"' "$state_smoke_directory/state/workflow.json" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" reopen delivery --actor user --note "re-encode delivery" >/dev/null
jq -e '.currentState == "render" and .completed == false and .revisionId == 2 and .gates["final-preview"].status == "auto-approved"' "$state_smoke_directory/state/workflow.json" >/dev/null
cp "$state_smoke_directory/output/final.mp4" "$state_smoke_directory/output/final.candidate.mp4"
node "$repository_root/scripts/workflow-state.mjs" "$state_smoke_directory/state/workflow.json" advance --artifact output/final.candidate.mp4 >/dev/null
jq -e '.currentState == "complete" and .completed == true and .lastKnownGoodDelivery.path == "output/final.mp4" and .lastKnownGoodDelivery.sha256 != null' "$state_smoke_directory/state/workflow.json" >/dev/null
[[ ! -e "$state_smoke_directory/output/final.candidate.mp4" ]] || { echo "Validated delivery candidate was not atomically promoted" >&2; exit 1; }
rm -rf "$state_smoke_directory"
rm -f "$smoke_video"
fi

scaffold_source="$(mktemp).mov"
touch "$scaffold_source"
scaffold_job="$(mktemp -d)"
"$repository_root/scripts/scaffold-project.sh" "$scaffold_job" "$scaffold_source" auto subtitles >/dev/null
for required_directory in input state roughcut docs captions hyperframes previews checkpoints logs output; do
  [[ -d "$scaffold_job/$required_directory" ]] || { echo "Missing scaffold directory: $required_directory" >&2; exit 1; }
done
jq -e '.mode == "auto" and .captionMode == "subtitles" and .captionModeSource == "user" and .captionModeAcknowledged == true and .currentState == "intake"' "$scaffold_job/state/workflow.json" >/dev/null
node "$repository_root/scripts/workflow-state.mjs" "$scaffold_job/state/workflow.json" advance >/dev/null
jq -e '.currentState == "transcription" and .referenceScriptStatus == "none" and .referenceScriptAcknowledged == false' "$scaffold_job/state/workflow.json" >/dev/null
if "$repository_root/scripts/scaffold-project.sh" "$scaffold_job" "$scaffold_source" review motion-copy >/dev/null 2>&1; then
  echo "Scaffold unexpectedly overwrote a non-empty job directory" >&2
  exit 1
fi
motion_copy_job="$(mktemp -d)"
"$repository_root/scripts/scaffold-project.sh" "$motion_copy_job" "$scaffold_source" review motion-copy >/dev/null
jq -e '.captionMode == "motion-copy" and (.storyboard | has("captionPlan") | not)' "$motion_copy_job/state/creative-confirmation.json" >/dev/null
[[ ! -e "$motion_copy_job/docs/caption-plan.md" ]] || { echo "Motion-copy scaffold unexpectedly created a caption plan" >&2; exit 1; }
grep -q '字幕模式：`motion-copy`' "$motion_copy_job/docs/creative-confirmation.md" || { echo "Motion-copy scaffold used the subtitle confirmation template" >&2; exit 1; }
rm -rf "$motion_copy_job"
rm -rf "$scaffold_job"
rm -f "$scaffold_source"

required_files=(
  "$repository_root/AGENTS.md"
  "$repository_root/CLAUDE.md"
  "$repository_root/LICENSE"
  "$repository_root/NOTICE"
  "$repository_root/README.md"
  "$repository_root/README-EN.md"
  "$repository_root/docs/agent-setup.md"
  "$repository_root/docs/visual-language.md"
  "$repository_root/docs/density-and-layout.md"
  "$repository_root/docs/talking-head-trim-standard.md"
  "$repository_root/docs/subtitle-mg-standard.md"
  "$repository_root/docs/subtitle-segmentation-standard.md"
  "$repository_root/docs/quality-gates.md"
  "$repository_root/docs/state-machine.md"
  "$repository_root/docs/caption-modes.md"
  "$repository_root/assets/design-system.default.json"
  "$repository_root/config/validation-evidence-contracts.json"
  "$repository_root/schemas/workflow.schema.json"
  "$repository_root/schemas/captions.schema.json"
  "$repository_root/schemas/chatcut-caption-pages.schema.json"
  "$repository_root/examples/chatcut-caption-pages.example.json"
  "$repository_root/examples/caption-reference.example.txt"
  "$repository_root/examples/caption-review-plan.example.json"
  "$repository_root/examples/caption-plan.example.md"
  "$repository_root/scripts/build-captions.mjs"
  "$repository_root/scripts/check-captions.mjs"
  "$repository_root/schemas/creative-confirmation.schema.json"
  "$repository_root/schemas/transcript-reconciliation.schema.json"
  "$repository_root/schemas/visual-sample-report.schema.json"
  "$repository_root/schemas/validation-receipt.schema.json"
  "$repository_root/scripts/install-captions.mjs"
  "$repository_root/scripts/check-caption-layer.mjs"
  "$repository_root/scripts/check-environment.sh"
  "$repository_root/scripts/audit-roughcut-seams.mjs"
  "$repository_root/scripts/check-trim-plan.mjs"
  "$repository_root/scripts/check-creative-confirmation.mjs"
  "$repository_root/scripts/check-creative-fingerprints.mjs"
  "$repository_root/scripts/check-transcript-reconciliation.mjs"
  "$repository_root/scripts/create-transcript-reconciliation.mjs"
  "$repository_root/scripts/register-reference-script.mjs"
  "$repository_root/scripts/resolve-transcript-item.mjs"
  "$repository_root/scripts/run-validation-check.mjs"
  "$repository_root/scripts/test-workflow-contracts.mjs"
  "$repository_root/scripts/build-caption-review-plan.mjs"
  "$repository_root/scripts/build-semantic-caption-proposal.mjs"
  "$repository_root/scripts/check-caption-review-plan.mjs"
  "$repository_root/scripts/remap-beat-caption-cues.mjs"
  "$repository_root/scripts/promote-caption-review-plan.mjs"
  "$repository_root/scripts/apply-mg-review-selection.mjs"
  "$repository_root/scripts/promote-job-media.mjs"
  "$repository_root/scripts/check-layout-constraints.mjs"
  "$repository_root/templates/job/creative-confirmation.json"
  "$repository_root/templates/job/creative-confirmation.md"
  "$repository_root/templates/job/creative-confirmation.motion-copy.md"
  "$repository_root/templates/job/transcript-reconciliation.json"
  "$repository_root/templates/job/visual-sample-report.json"
  "$repository_root/templates/job/qa-report.json"
  "$repository_root/templates/job/caption-plan.md"
  "$repository_root/templates/job/caption-lexicon.json"
  "$repository_root/templates/hyperframes/index.html"
  "$repository_root/examples/gold-standard/hyperframes/index.html"
)

for required_file in "${required_files[@]}"; do
  [[ -s "$required_file" ]] || { echo "Missing required file: $required_file" >&2; exit 1; }
done

echo "cut-motion repository verification passed."
