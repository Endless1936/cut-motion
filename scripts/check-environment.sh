#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/check-environment.sh check
  scripts/check-environment.sh install-job <job-directory> --yes

check verifies local cut-motion runtime dependencies. ChatCut is checked by the
active Agent session because it cannot be reliably discovered from a shell.

install-job first reuses exact-version modules from the local npx cache through
job-local symlinks. It downloads only dependencies that are still missing.
It never installs global packages, Agent plugins, fonts, or system dependencies.
EOF
}

command_name="${1:-check}"

require_command() {
  local name="$1"
  local hint="$2"

  if command -v "$name" >/dev/null 2>&1; then
    printf 'ok       %s\n' "$name"
    return
  fi

  printf 'missing  %s — %s\n' "$name" "$hint"
  missing_count=$((missing_count + 1))
}

check_environment() {
  local node_major
  missing_count=0

  require_command bash "install a Bash-compatible shell"
  require_command node "install Node.js 22 or newer"
  require_command npm "install npm with Node.js 22 or newer"
  require_command npx "install npm with Node.js 22 or newer"
  require_command ffmpeg "install FFmpeg with libx264 and AAC support"
  require_command ffprobe "install FFmpeg/FFprobe"
  require_command jq "install jq"

  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 22 )); then
      printf 'ok       Node.js %s\n' "$(node --version)"
    else
      printf 'missing  Node.js 22+ — found %s\n' "$(node --version)"
      missing_count=$((missing_count + 1))
    fi
  fi

  if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then
    printf 'ok       FFmpeg libx264 encoder\n'
  else
    printf 'missing  FFmpeg libx264 encoder — install a full FFmpeg build\n'
    missing_count=$((missing_count + 1))
  fi
  if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE '^[[:space:]]*A.*[[:space:]]aac[[:space:]]'; then
    printf 'ok       FFmpeg AAC encoder\n'
  else
    printf 'missing  FFmpeg AAC encoder — install a full FFmpeg build\n'
    missing_count=$((missing_count + 1))
  fi

  printf '%s\n' 'manual  ChatCut plugin — confirm it is enabled and authenticated when the selected workflow requires it'
  printf '%s\n' 'manual  Licensed WOFF2 font — add it to each job before composition rendering'

  if (( missing_count > 0 )); then
    printf '\nLocal preflight failed: %d required item(s) missing. Ask for user approval before installing anything.\n' "$missing_count" >&2
    return 1
  fi

  printf '\nLocal preflight passed. Verify ChatCut when required and add the font before rendering.\n'
}

install_job() {
  local job_directory="${1:-}"
  local approval="${2:-}"
  local hyperframes_directory node_modules_directory npm_cache
  local required_hyperframes_version required_gsap_version cached_hyperframes

  [[ -n "$job_directory" && "$approval" == "--yes" ]] || { usage >&2; exit 64; }
  hyperframes_directory="$job_directory/hyperframes"
  node_modules_directory="$hyperframes_directory/node_modules"
  [[ -f "$hyperframes_directory/package.json" ]] || { echo "Missing generated HyperFrames package: $hyperframes_directory/package.json" >&2; exit 66; }
  command -v npm >/dev/null 2>&1 || { echo "npm is required for per-job installation" >&2; exit 69; }
  read -r required_hyperframes_version required_gsap_version < <(
    node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1])); console.log(p.devDependencies.hyperframes,p.devDependencies.gsap)' "$hyperframes_directory/package.json"
  )
  npm_cache="$(npm config get cache)"

  module_version() {
    [[ -f "$1/package.json" ]] && node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).version)' "$1/package.json"
  }

  find_npx_module() {
    local package_json module_directory
    for package_json in "$npm_cache"/_npx/*/node_modules/"$1"/package.json; do
      [[ -f "$package_json" ]] || continue
      module_directory="${package_json%/package.json}"
      [[ "$(module_version "$module_directory" 2>/dev/null || true)" == "$2" ]] || continue
      (cd "$module_directory" && pwd -P)
      return
    done
    return 1
  }

  link_hyperframes_cli() {
    local binary
    binary="$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1])).bin; process.stdout.write(typeof b==="string"?b:b.hyperframes)' "$node_modules_directory/hyperframes/package.json")"
    mkdir -p "$node_modules_directory/.bin"
    ln -sfn "../hyperframes/$binary" "$node_modules_directory/.bin/hyperframes"
  }

  prepare_gsap() {
    local cached staging
    if [[ ! -f "$hyperframes_directory/assets/gsap.min.js"
      && "$(module_version "$node_modules_directory/gsap" 2>/dev/null || true)" != "$required_gsap_version" ]]; then
      rm -rf "$node_modules_directory/gsap"
      cached="$(find_npx_module gsap "$required_gsap_version" || true)"
      if [[ -n "$cached" ]]; then
        ln -s "$cached" "$node_modules_directory/gsap"
      else
        staging="$hyperframes_directory/.gsap-install"
        rm -rf "$staging"
        if ! npm install --prefix "$staging" --no-save --package-lock=false --ignore-scripts "gsap@$required_gsap_version"; then
          rm -rf "$staging"
          echo "No matching GSAP cache and download failed. Confirm network access and dependency-install approval, then retry." >&2
          exit 69
        fi
        mv "$staging/node_modules/gsap" "$node_modules_directory/gsap"
        rm -rf "$staging"
      fi
    fi
    [[ -f "$node_modules_directory/gsap/dist/gsap.min.js" ]] && cp "$node_modules_directory/gsap/dist/gsap.min.js" "$hyperframes_directory/assets/gsap.min.js"
    [[ -f "$hyperframes_directory/assets/gsap.min.js" ]] || { echo "GSAP browser runtime is missing" >&2; exit 66; }
  }

  if [[ ! -L "$node_modules_directory"
    && "$(module_version "$node_modules_directory/hyperframes" 2>/dev/null || true)" == "$required_hyperframes_version" ]]; then
    link_hyperframes_cli
    prepare_gsap
    echo "Reused job dependencies: $hyperframes_directory"
    return
  fi

  cached_hyperframes="$(find_npx_module hyperframes "$required_hyperframes_version" || true)"
  if [[ -n "$cached_hyperframes" ]]; then
    rm -rf "$node_modules_directory"
    mkdir -p "$node_modules_directory/.bin"
    ln -s "$cached_hyperframes" "$node_modules_directory/hyperframes"
    link_hyperframes_cli
    prepare_gsap
    echo "Linked cached HyperFrames@$required_hyperframes_version from $cached_hyperframes"
    return
  fi

  (
    cd "$hyperframes_directory"
    npm install || { echo "No matching HyperFrames cache and dependency download failed. Confirm network access and approval, then retry." >&2; exit 69; }
    npm run prepare:assets
  )

  echo "No matching npx cache; installed job dependencies: $hyperframes_directory"
}

case "$command_name" in
  check)
    [[ $# -eq 1 ]] || { usage >&2; exit 64; }
    check_environment
    ;;
  install-job)
    shift
    install_job "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
