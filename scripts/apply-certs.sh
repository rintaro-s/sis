#!/usr/bin/env bash
set -euo pipefail
J="$1"; [[ -z "${J:-}" && -f /etc/sis/provision.json ]] && J=$(cat /etc/sis/provision.json)
mkdir -p /usr/local/share/ca-certificates/sis
IDX=0
echo "$J" | jq -r '.certs[]? // empty' | while read -r PEM; do
  [[ -z "$PEM" ]] && continue
  FN="/usr/local/share/ca-certificates/sis/sis-${IDX}.crt"
  echo "$PEM" > "$FN"
  IDX=$((IDX+1))
done
update-ca-certificates || true
echo "[certs] installed"
