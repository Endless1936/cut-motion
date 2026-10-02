#!/usr/bin/env bash
set -euo pipefail

# Put a licensed display font into a job without hunting for it each time.
#
# Usage:
#   scripts/install-font.sh <job-directory> [--from <font-file>] [--download] [--force] [--quiet]
#
# Resolution order: --from, then the repository cache under assets/fonts/, then the
# fonts already installed in another job's hyperframes directory, then an explicit
# --download from the upstream release. Nothing is fetched implicitly, because a
# network download needs user approval.
#
# The installed file is copied into <job>/hyperframes/<fontAsset>, the license
# travels with it, and design-system.json is repointed at the installed asset so
# scripts/check-font.sh can verify the pair. Existing installations are left alone
# unless --force is passed.

usage() {
  cat <<'EOF'
Usage: scripts/install-font.sh <job-directory> [--from <font-file>] [--download] [--force] [--quiet]

Installs the design system's display font into a job and repoints
state/design-system.json at it. Exits 0 when the font is in place, 1 when no usable
source is available, and 64 on a usage error.
EOF
}

job_directory="${1:-}"
[[ -n "$job_directory" && "$job_directory" != --* ]] || { usage >&2; exit 64; }
shift || true

font_source=""
allow_download=""
force=""
quiet=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) font_source="${2:-}"; shift 2 ;;
    --download) allow_download=1; shift ;;
    --force) force=1; shift ;;
    --quiet) quiet=1; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
job_directory="$(cd "$job_directory" && pwd)"
hyperframes_directory="${job_directory}/hyperframes"
cache_directory="${repository_root}/assets/fonts"
download_url="${CUT_MOTION_FONT_URL:-https://github.com/atelier-anchor/smiley-sans/releases/latest/download/smiley-sans-v2.0.1.zip}"

[[ -d "$hyperframes_directory" ]] || { echo "Missing HyperFrames directory: $hyperframes_directory" >&2; exit 66; }
for tool in node jq; do command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 69; }; done

design_system="${job_directory}/state/design-system.json"
[[ -f "$design_system" ]] || design_system="${repository_root}/assets/design-system.default.json"
[[ -f "$design_system" ]] || { echo "No design system found to read the font asset from" >&2; exit 66; }

font_asset="$(jq -r '.typography.fontAsset // empty' "$design_system")"
[[ -n "$font_asset" ]] || { echo "Design system does not declare typography.fontAsset" >&2; exit 66; }
font_family="$(jq -r '.typography.displayFamily // "display font"' "$design_system")"
target="${hyperframes_directory}/${font_asset}"

if [[ -s "$target" && -z "$force" ]]; then
  [[ -n "$quiet" ]] || echo "Display font already installed: ${font_asset}"
  exit 0
fi

install_from() {
  # Resolves a usable font file; the copy happens once the target name is known.
  local candidate="$1"
  [[ -s "$candidate" ]] || return 1
  printf '%s\n' "$candidate"
}

resolved=""

if [[ -n "$font_source" ]]; then
  [[ -s "$font_source" ]] || { echo "Font source not found: $font_source" >&2; exit 66; }
  resolved="$(install_from "$font_source")"
fi

if [[ -z "$resolved" ]]; then
  for extension in woff2 ttf otf; do
    for cached in "$cache_directory"/smiley-sans-oblique."$extension" "$cache_directory"/SmileySans-Oblique."$extension"; do
      [[ -s "$cached" ]] || continue
      resolved="$(install_from "$cached")"
      break 2
    done
  done
fi

if [[ -z "$resolved" ]]; then
  for candidate in "$repository_root"/jobs/*/hyperframes/assets/fonts/*; do
    [[ -s "$candidate" ]] || continue
    case "$candidate" in
      *LICENSE*) continue ;;
    esac
    resolved="$(install_from "$candidate")"
    break
  done
fi

if [[ -z "$resolved" && -n "$allow_download" ]]; then
  command -v curl >/dev/null 2>&1 || { echo "curl is required for --download" >&2; exit 69; }
  command -v unzip >/dev/null 2>&1 || { echo "unzip is required for --download" >&2; exit 69; }
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  if curl -fsSL --max-time 120 "$download_url" -o "$staging/font.zip"; then
    unzip -q -o "$staging/font.zip" -d "$staging/unpacked" 2>/dev/null || {
      echo "Could not unpack the downloaded font archive" >&2
      exit 1
    }
    for extension in woff2 ttf otf; do
      candidate="$(find "$staging/unpacked" -type f -iname "*."$extension -print -quit)"
      [[ -n "$candidate" ]] || continue
      mkdir -p "$cache_directory"
      cp "$candidate" "$cache_directory/smiley-sans-oblique.$extension"
      resolved="$(install_from "$cache_directory/smiley-sans-oblique.$extension")"
      break
    done
  else
    echo "Download failed: $download_url" >&2
    echo "Set CUT_MOTION_FONT_URL to a reachable release archive, or pass --from <font-file>." >&2
    exit 1
  fi
fi

if [[ -z "$resolved" ]]; then
  {
    echo "No display font available for ${font_family}."
    echo "Provide one of:"
    echo "  --from <font-file>                                     a file you already have"
    echo "  ${cache_directory}/smiley-sans-oblique.{woff2,ttf,otf}  the shared local cache"
    echo "  --download                                             fetch the upstream release (needs approval)"
    echo "Missing font media is not fatal: the composition falls back to sans-serif."
  } >&2
  exit 1
fi

# The installed name must match the file's real format, so an available TTF is
# installed as a TTF rather than masquerading under a .woff2 name.
source_extension="${resolved##*.}"
source_extension="$(printf '%s' "$source_extension" | tr '[:upper:]' '[:lower:]')"
case "$font_asset" in
  *."$source_extension") ;;
  *) font_asset="assets/fonts/$(basename "$resolved")" ;;
esac
target="${hyperframes_directory}/${font_asset}"
mkdir -p "$(dirname "$target")"
cp "$resolved" "$target"

# Keep the license next to the font so redistribution stays compliant.
license_target="$(dirname "$target")/LICENSE.txt"
if [[ ! -s "$license_target" ]]; then
  for candidate in "$(dirname "$resolved")/LICENSE.txt" "$cache_directory/LICENSE.txt" "$repository_root/LICENSE"; do
    [[ -s "$candidate" ]] || continue
    cp "$candidate" "$license_target"
    break
  done
fi

# Repoint the design system at the format that is actually installed.
if [[ -f "${job_directory}/state/design-system.json" ]]; then
  node -e '
    const fs = require("fs");
    const [file, asset] = process.argv.slice(1);
    const design = JSON.parse(fs.readFileSync(file, "utf8"));
    design.typography.fontAsset = asset;
    for (const value of Object.values(design.motion ?? {})) {
      if (value && typeof value === "object" && "fontAsset" in value) value.fontAsset = asset;
    }
    fs.writeFileSync(file, `${JSON.stringify(design, null, 2)}\n`);
  ' "$design_system" "$font_asset"
fi

# The HyperFrames template hardcodes a WOFF2 @font-face, so an installed TTF would
# otherwise never be referenced. Point every composition source at the real asset.
case "$source_extension" in
  woff2) font_format="woff2" ;;
  otf) font_format="opentype" ;;
  *) font_format="truetype" ;;
esac
for page in "${hyperframes_directory}/index.template.html" "${hyperframes_directory}/index.html"; do
  [[ -s "$page" ]] || continue
  node -e '
    const fs = require("fs");
    const [file, asset, format] = process.argv.slice(1);
    const declaration = `src: url("./${asset}") format("${format}");`;
    const existing = fs.readFileSync(file, "utf8");
    const updated = existing.replace(
      /@font-face\s*\{[^}]*\}/g,
      (block) => (/src:\s*url\([^)]*\)\s*(format\([^)]*\))?;/.test(block)
        ? block.replace(/src:\s*url\([^)]*\)\s*(format\([^)]*\))?;/, declaration)
        : block.replace(/\}\s*$/, `  ${declaration}\n      }`))
    );
    if (updated !== existing) fs.writeFileSync(file, updated);
  ' "$page" "$font_asset" "$font_format"
done

if [[ -f "${script_directory}/check-font.sh" ]]; then
  bash "${script_directory}/check-font.sh" "$hyperframes_directory" "$design_system" >/dev/null 2>&1 \
    || echo "note: check-font.sh did not pass yet; the composition must reference ${font_asset}" >&2
fi

[[ -n "$quiet" ]] || {
  echo "Installed ${font_family}: ${font_asset}"
  echo "  from ${resolved}"
  [[ -s "$license_target" ]] && echo "  license: ${license_target#"$job_directory"/}"
}
