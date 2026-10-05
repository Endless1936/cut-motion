#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/check-environment.sh check
  scripts/check-environment.sh chatcut [probe arguments]
  scripts/check-environment.sh install-job <job-directory>

check verifies local cut-motion runtime dependencies. Use ChatCut tools already
loaded in the active Agent session; if unavailable, report it and stop. Run the
endpoint probe only to diagnose a specific connection failure.

install-job checks the repository's ignored node_modules first. If no exact
version is available locally, it installs the pinned packages there.
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

  printf '%s\n' 'manual  ChatCut — use currently loaded Agent tools; report immediately if unavailable'

  if (( missing_count > 0 )); then
    printf '\nLocal preflight failed: %d required system tool(s) missing. Follow the OS setup guide; ask before installing global or system dependencies.\n' "$missing_count" >&2
    return 1
  fi

  printf '\nLocal dependencies passed; a local display font is optional.\n'
}

install_job() {
  local job_directory="${1:-}"
  local hyperframes_directory node_modules_directory npm_cache
  local cache_directory cache_node_modules staging
  local required_hyperframes_version required_gsap_version cached_hyperframes cached_gsap

  [[ -n "$job_directory" && ( $# -eq 1 || ( $# -eq 2 && "${2:-}" == "--yes" ) ) ]] || { usage >&2; exit 64; }
  hyperframes_directory="$job_directory/hyperframes"
  node_modules_directory="$hyperframes_directory/node_modules"
  [[ -f "$hyperframes_directory/package.json" ]] || { echo "Missing generated HyperFrames package: $hyperframes_directory/package.json" >&2; exit 66; }
  command -v npm >/dev/null 2>&1 || { echo "npm is required to prepare the shared dependency cache" >&2; exit 69; }
  read -r required_hyperframes_version required_gsap_version < <(
    node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1])); console.log(p.devDependencies.hyperframes,p.devDependencies.gsap)' "$hyperframes_directory/package.json"
  )
  npm_cache="$(npm config get cache)"
  cache_directory="$repository_root"
  cache_node_modules="$cache_directory/node_modules"

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
      [[ "$(module_version "$candidate/gsap" 2>/dev/null || true)" == "$required_gsap_version" ]] || continue
      module_cli_valid "$candidate/hyperframes" >/dev/null 2>&1 || continue
      [[ -f "$candidate/gsap/dist/gsap.min.js" ]] || continue
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
    if [[ "$target_directory" == "$cache_node_modules" ]]; then
      local prepared
      prepared="$(mktemp -d "$hyperframes_directory/.dependency-reuse.XXXXXX")"
      if cp -R -L "$source_directory/." "$prepared/"; then
        publish_dependencies "$prepared"
        remove_path "$prepared"
        return
      fi
      remove_path "$prepared"
      return 1
    fi
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

  publish_dependencies() {
    # Replace prepared package entries, preserving unrelated root dependencies.
    node - "$1" "$cache_node_modules" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [source, target] = process.argv.slice(2);
fs.mkdirSync(target, { recursive: true });
const sameEntry = (from, to) => fs.existsSync(from) && fs.existsSync(to) && fs.realpathSync(from) === fs.realpathSync(to);
for (const entry of fs.readdirSync(source)) {
  const prepared = path.join(source, entry);
  const destination = path.join(target, entry);
  if (sameEntry(prepared, destination)) continue;
  if (entry === ".bin" || entry.startsWith("@")) {
    fs.mkdirSync(destination, { recursive: true });
    for (const child of fs.readdirSync(path.join(source, entry))) {
      const childTarget = path.join(destination, child);
      if (sameEntry(path.join(source, entry, child), childTarget)) continue;
      fs.rmSync(childTarget, { recursive: true, force: true });
      fs.renameSync(path.join(source, entry, child), childTarget);
    }
  } else {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(path.join(source, entry), destination);
  }
}
NODE
  }

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
        mkdir -p "$cache_directory" "$cache_node_modules"
        staging="$hyperframes_directory/.gsap-install-$process_id"
        rm -rf "$staging"
        if ! npm install --prefix "$staging" --no-save --package-lock=false --ignore-scripts "gsap@$required_gsap_version"; then
          rm -rf "$staging"
          echo "Could not retrieve the pinned GSAP package. Check npm network access and retry." >&2
          exit 69
        fi
        publish_dependencies "$staging/node_modules"
        ln -s "$cache_node_modules/gsap" "$node_modules_directory/gsap"
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

  cache_valid() {
    [[ "$(module_version "$cache_node_modules/hyperframes" 2>/dev/null || true)" == "$required_hyperframes_version" ]] \
      && module_cli_valid "$cache_node_modules/hyperframes" >/dev/null 2>&1 \
      && [[ "$(module_version "$cache_node_modules/gsap" 2>/dev/null || true)" == "$required_gsap_version" ]] \
      && [[ -f "$cache_node_modules/gsap/dist/gsap.min.js" ]]
  }

  remove_path() {
    node -e 'require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })' "$1"
  }

  attach_shared_cache() {
    local linked_target=""
    if [[ -L "$node_modules_directory" ]]; then
      linked_target="$(readlink "$node_modules_directory")"
    fi
    if [[ "$linked_target" != "$cache_node_modules" ]]; then
      if [[ -e "$node_modules_directory" || -L "$node_modules_directory" ]]; then
        remove_path "$node_modules_directory"
      fi
      ln -s "$cache_node_modules" "$node_modules_directory"
    fi
    link_hyperframes_cli
    validate_hyperframes || return 1
    prepare_gsap
  }

  move_job_dependencies_to_shared_cache() {
    mkdir -p "$cache_directory"
    if ! cache_valid; then
      [[ -d "$node_modules_directory" && ! -L "$node_modules_directory" ]] || return 1
      publish_dependencies "$node_modules_directory"
      remove_path "$node_modules_directory"
    fi
    cache_valid || return 1
    attach_shared_cache
  }

  if cache_valid; then
    attach_shared_cache || { echo "Could not link shared dependencies into this job" >&2; exit 66; }
    echo "Reused pinned HyperFrames/GSAP: $cache_node_modules"
    return
  fi

  if [[ ! -L "$node_modules_directory"
    && "$(module_version "$node_modules_directory/hyperframes" 2>/dev/null || true)" == "$required_hyperframes_version" ]] \
    && module_cli_valid "$node_modules_directory/hyperframes" >/dev/null 2>&1 \
    && [[ "$(module_version "$node_modules_directory/gsap" 2>/dev/null || true)" == "$required_gsap_version" ]] \
    && [[ -f "$node_modules_directory/gsap/dist/gsap.min.js" ]]; then
    link_hyperframes_cli
    validate_hyperframes || { echo "Existing job HyperFrames installation is incomplete" >&2; exit 66; }
    prepare_gsap || exit 66
    move_job_dependencies_to_shared_cache || { echo "Could not move job dependencies into the shared repository cache" >&2; exit 66; }
    echo "Adopted job dependencies: $cache_node_modules"
    return
  fi

  cached_hyperframes="$(find_job_node_modules || true)"
  if [[ -n "$cached_hyperframes" ]]; then
    rm -rf "$node_modules_directory"
    if copy_tree "$cached_hyperframes" "$cache_node_modules"; then
      ln -s "$cache_node_modules" "$node_modules_directory"
      link_hyperframes_cli
      if validate_hyperframes && prepare_gsap; then
        move_job_dependencies_to_shared_cache || { echo "Could not move reusable dependencies into the shared cache" >&2; exit 66; }
        echo "Reused dependencies from ${cached_hyperframes%/hyperframes/node_modules}: $cache_node_modules"
        return
      fi
    fi
    rm -rf "$node_modules_directory"
  fi

  cached_hyperframes="$(find_npx_module hyperframes "$required_hyperframes_version" || true)"
  cached_gsap="$(find_npx_module gsap "$required_gsap_version" || true)"
  if [[ -n "$cached_hyperframes" && -n "$cached_gsap" ]]; then
    rm -rf "$node_modules_directory"
    mkdir -p "$node_modules_directory/.bin"
    ln -s "$cached_hyperframes" "$node_modules_directory/hyperframes"
    ln -s "$cached_gsap" "$node_modules_directory/gsap"
    link_hyperframes_cli
    if validate_hyperframes && prepare_gsap; then
      move_job_dependencies_to_shared_cache || { echo "Could not move cached dependencies into the shared repository cache" >&2; exit 66; }
      echo "Reused npm-cached dependencies: $cache_node_modules"
      return
    fi
    rm -rf "$node_modules_directory"
  fi

  staging="$hyperframes_directory/.install-$process_id"
  if [[ -e "$staging" || -L "$staging" ]]; then
    remove_path "$staging"
  fi
  mkdir -p "$staging"
  cp "$hyperframes_directory/package.json" "$staging/package.json"
  if [[ -f "$hyperframes_directory/package-lock.json" ]]; then
    cp "$hyperframes_directory/package-lock.json" "$staging/package-lock.json"
  fi
  if ! npm install --prefix "$staging" --no-audit --no-fund; then
    remove_path "$staging"
    echo "Could not install the pinned HyperFrames/GSAP packages into the repository cache. Check npm network access and retry." >&2
    exit 69
  fi
  publish_dependencies "$staging/node_modules"
  remove_path "$staging"

  move_job_dependencies_to_shared_cache || { echo "Could not move installed dependencies into the shared repository cache" >&2; exit 66; }
  echo "Installed pinned dependencies: $cache_node_modules"
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
