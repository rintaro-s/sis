#!/usr/bin/env bash
set -euo pipefail
J="$1"; [[ -z "${J:-}" && -f /etc/sis/provision.json ]] && J=$(cat /etc/sis/provision.json)
BLOCK_LIST=$(echo "$J" | jq -r '.restrictions.block_processes[]? // empty')
for p in $BLOCK_LIST; do
  pkill -f "$p" 2>/dev/null || true
done
echo "$J" | jq -r '.restrictions.hosts_block[]? // empty' | while read -r h; do
  grep -q "^0.0.0.0 $h$" /etc/hosts || echo "0.0.0.0 $h" >> /etc/hosts
done
echo "[restrictions] applied"
