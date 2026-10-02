#!/usr/bin/env bash
set -euo pipefail

# Rebuild the composition and run the pinned HyperFrames check against it.
#
# The check inspects every root-level .html file that declares data-composition-id
# and fails when it finds more than one. The authored hyperframes/index.template.html
# is exactly that, so running the check in place always reports
# `multiple_root_compositions` even though the composition is correct. This command
# checks a pruned staging root that holds only the generated composition, which is
# what the rule is actually about.
#
# Usage:
#   scripts/check-composition.sh <job-directory> [--samples <n>] [--keep] [--quiet]

usage() {
  cat <<'EOF'
Usage: scripts/check-composition.sh <job-directory> [--samples <n>] [--keep] [--quiet]

Rebuilds hyperframes/index.html from the authored sources, then runs lint, runtime,
layout, motion, and WCAG contrast checks against a pruned copy of the composition.
--keep leaves the staging directory in place for inspection. Exits 0 when the check
passes and 1 when it does not; a composition error exits 66.
EOF
}

job_directory="${1:-}"
[[ -n "$job_directory" && "$job_directory" != --* ]] || { usage >&2; exit 64; }
shift || true

samples=""
keep=""
quiet=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples) samples="${2:-}"; shift 2 ;;
    --keep) keep=1; shift ;;
    --quiet) quiet=1; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
job_directory="$(cd "$job_directory" && pwd)"
hyperframes_directory="${job_directory}/hyperframes"

[[ -d "$hyperframes_directory" ]] || { echo "Missing HyperFrames directory: $hyperframes_directory" >&2; exit 66; }
[[ -x "${hyperframes_directory}/node_modules/.bin/hyperframes" ]] || {
  echo "The job's pinned HyperFrames CLI is missing; run scripts/check-environment.sh install-job first" >&2
  exit 66
}

node "${script_directory}/build-composition.mjs" "$hyperframes_directory" >/dev/null
[[ -s "${hyperframes_directory}/index.html" ]] || { echo "Composition build produced no hyperframes/index.html" >&2; exit 66; }

staging="$(mktemp -d "${TMPDIR:-/tmp}/cut-motion-check.XXXXXX")"
cleanup() {
  [[ -n "$keep" ]] || rm -rf "$staging"
}
trap cleanup EXIT

# Real files for anything the lint reads; a symlink for the media directory, which
# is large and irrelevant to the rules being checked.
for item in index.html caption.css hyperframes.json; do
  [[ -e "${hyperframes_directory}/${item}" ]] || continue
  cp "${hyperframes_directory}/${item}" "$staging/"
done
for directory in mg compositions; do
  [[ -d "${hyperframes_directory}/${directory}" ]] || continue
  cp -R "${hyperframes_directory}/${directory}" "$staging/"
done
[[ -d "${hyperframes_directory}/assets" ]] && ln -s "${hyperframes_directory}/assets" "$staging/assets"

command=("${hyperframes_directory}/node_modules/.bin/hyperframes" check "$staging")
[[ -n "$samples" ]] && command+=(--samples "$samples")

set +e
output="$("${command[@]}" 2>&1)"
status=$?
set -e

if [[ -z "$quiet" ]]; then
  printf '%s\n' "$output" | grep -vE '^(Layout|Motion|Contrast|Snapshots|Runtime)$' | sed '/^$/d'
  [[ -n "$keep" ]] && { echo; echo "Staging root kept at: ${staging}"; }
fi

if (( status != 0 )); then
  echo "Composition check failed." >&2
  exit 1
fi
[[ -n "$quiet" ]] || echo "Composition check passed."
