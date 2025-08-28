#!/usr/bin/env bash
set -euo pipefail
J="$1"; [[ -z "${J:-}" && -f /etc/sis/provision.json ]] && J=$(cat /etc/sis/provision.json)
echo "$J" | jq -c '.printers[]? // empty' | while read -r P; do
  NAME=$(echo "$P" | jq -r '.name')
  URI=$(echo "$P" | jq -r '.uri')
  MODEL=$(echo "$P" | jq -r '.model // "everywhere"')
  lpadmin -x "$NAME" 2>/dev/null || true
  lpadmin -p "$NAME" -v "$URI" -m "$MODEL" -E || true
done
systemctl enable --now cups || true
echo "[printers] applied"
