#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "Usage: $0 <input.json> <cut-start-seconds> <cut-end-seconds> <new-output.json> [fps]" >&2
  exit 64
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_directory/shift-timestamps.mjs" "$@"
