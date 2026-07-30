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
  "source": "roughcut/a-roll.mp4",
  "fps": 30,
  "remove": [{"start": 0.7, "end": 1.2, "reason": "reset", "confidence": 0.9}],
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
    "reason": "visible reading reset",
    "semanticEvidence": "duplicate take",
    "visualEvidence": "gaze leaves lens",
    "confidence": 0.9,
    "acousticBoundaryFrames": [20, 21, 22],
    "appliedFrame": 21,
    "audioTransitionFrames": 2,
    "pictureAudited": true,
    "audioAudited": true
  }],
  "verification": {"everySeamAudited": true, "contiguous": true}
}
EOF

node "$repository_root/scripts/check-trim-plan.mjs" "$plan" --require-audit >/dev/null
for mutation in \
  'del(.seams[0].audioAudited)' \
  '.seams[0].audioTransitionFrames = 3' \
  '.remove = [{"start": 1, "end": 1.5}, {"start": 0.2, "end": 0.4}]'; do
  invalid="$temporary_root/invalid.json"
  jq "$mutation" "$plan" > "$invalid"
  if node "$repository_root/scripts/check-trim-plan.mjs" "$invalid" --require-audit >/dev/null 2>&1; then
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
  -t 2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$input"

output="$temporary_root/trimmed.mp4"
bash "$repository_root/scripts/apply-trim-plan.sh" "$input" "$plan" "$output" >/dev/null 2>&1
duration="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$output")"
awk "BEGIN { exit !($duration > 1.4 && $duration < 1.6) }" || {
  echo "Trimmed media duration is incorrect: $duration" >&2
  exit 1
}
[[ -n "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$output")" ]] || {
  echo "Trimmed media lost audio" >&2
  exit 1
}

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
