#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/check-environment.sh check
  scripts/check-environment.sh chatcut [probe arguments]
  scripts/check-environment.sh install-job <job-directory> --yes

check verifies local cut-motion runtime dependencies and probes ChatCut when an
MCP endpoint is configured. Run `chatcut` on its own to print the full tool list
or to see the exact remedy when the connector is not usable.

install-job first reuses exact-version modules already available to the local
machine through job-local links or copies. It downloads only dependencies that
are still missing.
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

  printf '%s\n' 'optional Licensed WOFF2 font — add it to a job when available; otherwise composition uses sans-serif'

  # One probe replaces the manual ChatCut diagnosis. It is reported but not
  # counted as missing: only ChatCut rough cuts need it, the FFmpeg fallback does not.
  local chatcut_output=""
  if chatcut_output="$(node "$script_directory/check-chatcut.mjs" --quiet --timeout 8 2>&1)"; then
    printf '%s\n' "$chatcut_output"
  else
    printf '%s\n' "$(printf '%s' "$chatcut_output" | sed -n '1,2p')"
    printf '%s\n' '         ChatCut is required only for ChatCut rough cuts; the FFmpeg fallback does not need it.'
  fi

  if (( missing_count > 0 )); then
    printf '\nLocal preflight failed: %d required item(s) missing. Ask for user approval before installing anything.\n' "$missing_count" >&2
    return 1
  fi

  printf '\nLocal preflight passed. Confirm ChatCut is trusted when the job uses it; a local display font is optional.\n'
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
      if [[ "$1" == "hyperframes" ]] && ! module_cli_valid "$module_directory" >/dev/null 2>&1; then
        continue
      fi
      if [[ "$1" == "gsap" && ! -f "$module_directory/dist/gsap.min.js" ]]; then
        continue
      fi
      (cd "$module_directory" && pwd -P)
      return
    done
    return 1
  }

  module_cli_valid() {
    node -e '
      const fs = require("fs");
      const path = require("path");
      const moduleDirectory = process.argv[1];
      const packageJson = JSON.parse(fs.readFileSync(path.join(moduleDirectory, "package.json"), "utf8"));
      const binary = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.hyperframes;
      if (typeof binary !== "string" || !binary) process.exit(1);
      const binaryPath = path.resolve(moduleDirectory, binary);
      if (!fs.existsSync(binaryPath)) process.exit(1);
      const binaryStat = fs.statSync(binaryPath);
      if (!binaryStat.isFile() || (binaryStat.mode & 0o111) === 0) process.exit(1);
    ' "$1"
  }

  find_job_node_modules() {
    local candidate source_job candidate_real current_job_real
    current_job_real="$(cd "$job_directory" && pwd -P)"
    for candidate in "$repository_root"/jobs/*/hyperframes/node_modules; do
      [[ -d "$candidate" && ! -L "$candidate" ]] || continue
      source_job="${candidate%/hyperframes/node_modules}"
      candidate_real="$(cd "$source_job" && pwd -P)"
      [[ "$candidate_real" != "$current_job_real" ]] || continue
      [[ "$(module_version "$candidate/hyperframes" 2>/dev/null || true)" == "$required_hyperframes_version" ]] || continue
      module_cli_valid "$candidate/hyperframes" >/dev/null 2>&1 || continue
      printf '%s\n' "$candidate"
      return
    done
    return 1
  }

  find_job_module() {
    local package_name="$1"
    local required_version="$2"
    local candidate source_job candidate_real current_job_real
    current_job_real="$(cd "$job_directory" && pwd -P)"
    for candidate in "$repository_root"/jobs/*/hyperframes/node_modules/"$package_name"; do
      [[ -d "$candidate" ]] || continue
      source_job="${candidate%/hyperframes/node_modules/$package_name}"
      candidate_real="$(cd "$source_job" && pwd -P)"
      [[ "$candidate_real" != "$current_job_real" ]] || continue
      [[ "$(module_version "$candidate" 2>/dev/null || true)" == "$required_version" ]] || continue
      if [[ "$package_name" == "gsap" && ! -f "$candidate/dist/gsap.min.js" ]]; then
        continue
      fi
      printf '%s\n' "$candidate"
      return
    done
    return 1
  }

  copy_tree() {
    local source_directory="$1"
    local target_directory="$2"
    local staging_directory="${target_directory}.${process_id}.reuse"
    [[ -d "$source_directory" ]] || return 1
    rm -rf "$staging_directory"
    mkdir -p "$staging_directory"
    if ! cp -R -L "$source_directory/." "$staging_directory/"; then
      rm -rf "$staging_directory"
      return 1
    fi
    rm -rf "$target_directory"
    mv "$staging_directory" "$target_directory"
  }

  process_id="$$"

  link_hyperframes_cli() {
    local binary
    binary="$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1])).bin; process.stdout.write(typeof b==="string"?b:b.hyperframes)' "$node_modules_directory/hyperframes/package.json")"
    mkdir -p "$node_modules_directory/.bin"
    rm -f "$node_modules_directory/.bin/hyperframes"
    ln -sfn "../hyperframes/$binary" "$node_modules_directory/.bin/hyperframes"
  }

  validate_hyperframes() {
    node --input-type=module -e '
      const { pathToFileURL } = await import("node:url");
      const { resolveLockedHyperframesCli } = await import(pathToFileURL(process.argv[1]).href);
      resolveLockedHyperframesCli(process.argv[2]);
    ' "$script_directory/workflow-utils.mjs" "$job_directory" >/dev/null 2>&1
  }

  prepare_gsap() {
    local cached staging
    if [[ "$(module_version "$node_modules_directory/gsap" 2>/dev/null || true)" != "$required_gsap_version"
      || ! -f "$node_modules_directory/gsap/dist/gsap.min.js" ]]; then
      rm -rf "$node_modules_directory/gsap"
      cached="$(find_job_module gsap "$required_gsap_version" || true)"
      if [[ -n "$cached" ]]; then
        copy_tree "$cached" "$node_modules_directory/gsap" || cached=""
      fi
      if [[ -z "$cached" ]]; then
        cached="$(find_npx_module gsap "$required_gsap_version" || true)"
      fi
      if [[ -n "$cached" ]]; then
        [[ -d "$node_modules_directory/gsap" ]] || ln -s "$cached" "$node_modules_directory/gsap"
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
    [[ "$(module_version "$node_modules_directory/gsap" 2>/dev/null || true)" == "$required_gsap_version"
      && -f "$node_modules_directory/gsap/dist/gsap.min.js" ]] || {
      echo "GSAP@$required_gsap_version is missing or incomplete" >&2
      return 1
    }
    mkdir -p "$hyperframes_directory/assets"
    cp "$node_modules_directory/gsap/dist/gsap.min.js" "$hyperframes_directory/assets/gsap.min.js"
    [[ -f "$hyperframes_directory/assets/gsap.min.js" ]] || { echo "GSAP browser runtime is missing" >&2; exit 66; }
  }

  if [[ ! -L "$node_modules_directory"
    && "$(module_version "$node_modules_directory/hyperframes" 2>/dev/null || true)" == "$required_hyperframes_version" ]] \
    && module_cli_valid "$node_modules_directory/hyperframes" >/dev/null 2>&1; then
    link_hyperframes_cli
    validate_hyperframes || { echo "Existing job HyperFrames installation is incomplete" >&2; exit 66; }
    prepare_gsap || exit 66
    echo "Reused job dependencies: $hyperframes_directory"
    return
  fi

  cached_hyperframes="$(find_job_node_modules || true)"
  if [[ -n "$cached_hyperframes" ]]; then
    rm -rf "$node_modules_directory"
    if copy_tree "$cached_hyperframes" "$node_modules_directory"; then
      link_hyperframes_cli
      if validate_hyperframes && prepare_gsap; then
        echo "Copied reusable job dependencies from ${cached_hyperframes%/hyperframes/node_modules}: $hyperframes_directory"
        return
      fi
    fi
    rm -rf "$node_modules_directory"
  fi

  cached_hyperframes="$(find_npx_module hyperframes "$required_hyperframes_version" || true)"
  if [[ -n "$cached_hyperframes" ]]; then
    rm -rf "$node_modules_directory"
    mkdir -p "$node_modules_directory/.bin"
    ln -s "$cached_hyperframes" "$node_modules_directory/hyperframes"
    link_hyperframes_cli
    if validate_hyperframes && prepare_gsap; then
      echo "Linked cached HyperFrames@$required_hyperframes_version from $cached_hyperframes"
      return
    fi
    rm -rf "$node_modules_directory"
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
  chatcut)
    shift
    node "$script_directory/check-chatcut.mjs" "$@"
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
