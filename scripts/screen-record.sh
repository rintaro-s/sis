#!/usr/bin/env bash
set -euo pipefail
# very naive PoC for screenshot or short record
mode="${1:-shot}" # shot|gif
out="${2:-}"
if [[ "$mode" == "shot" ]]; then
  out="${out:-/tmp/sis-shot.png}"
  if command -v grim >/dev/null 2>&1; then # wayland
    grim "$out"
  elif command -v gnome-screenshot >/dev/null 2>&1; then
    gnome-screenshot -f "$out"
  elif command -v import >/dev/null 2>&1; then
    import -window root "$out"
  else
    echo "screenshot tool not found" >&2; exit 1
  fi
  echo "$out"
else
  echo "gif not implemented" >&2; exit 1
fi
