#!/usr/bin/env bash
set -euo pipefail
# 想定: /var/lib/sis-mdm/policies.json に screen_time.* が同期済み
STATE=/var/lib/sis-mdm
POL=$STATE/policies.json
[[ ! -f "$POL" ]] && exit 0
allow=$(jq -r '.screen_time.allow // false' "$POL" 2>/dev/null || echo false)
[[ "$allow" != "true" ]] && exit 0
start=$(jq -r '.screen_time.start // "00:00"' "$POL")
end=$(jq -r '.screen_time.end // "23:59"' "$POL")
now=$(date +%H:%M)
if [[ "$now" < "$start" || "$now" > "$end" ]]; then
  wall "[SIS] スクリーンタイム: 使用不可時間帯です"
  loginctl lock-sessions || true
fi
