#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <hyperframes-directory> <design-system.json>" >&2
  exit 64
fi

hyperframes_directory="$1"
design_system="$2"
font_family="$(jq -r '.typography.displayFamily' "$design_system")"
font_asset="$(jq -r '.typography.fontAsset' "$design_system")"
font_file="$hyperframes_directory/$font_asset"
index_file="$hyperframes_directory/index.html"

[[ -s "$font_file" ]] || { echo "Missing required font asset: $font_file" >&2; exit 1; }
grep -Fq '@font-face' "$index_file" || { echo "Missing @font-face declaration: $index_file" >&2; exit 1; }
grep -Fq "font-family: \"$font_family\"" "$index_file" || grep -Fq "font-family: '$font_family'" "$index_file" || { echo "Missing font-family declaration for $font_family" >&2; exit 1; }
grep -Fq "$font_asset" "$index_file" || { echo "Composition does not reference required font asset: $font_asset" >&2; exit 1; }

echo "Font verification passed: $font_family"
