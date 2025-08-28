#!/usr/bin/env bash
set -euo pipefail
root=${1:-$HOME}
find "$root" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -printf '{"path":"%p","size":%s,"mt":%T@}\n' | jq -s '.'
