#!/usr/bin/env bash
set -euo pipefail
. /etc/sis/sis.conf 2>/dev/null || true
log(){ echo "[mdm] $*"; }

API="${SIS_MDM_URL:-}"
TOKEN="${SIS_MDM_TOKEN:-}"
STATE_DIR="/var/lib/sis-mdm"; sudo install -d -m 0755 "$STATE_DIR"

api() { # path method data_json -> stdout
  local path="$1"; shift
  local method="${1:-GET}"; shift || true
  local data="${1:-}"
  [[ -z "$API" ]] && { log "MDM URL not configured"; return 1; }
  curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X "$method" "${API%/}/$path" ${data:+--data "$data"}
}

enroll(){
  local hostname=$(hostname)
  local payload=$(jq -n --arg hn "$hostname" '{hostname:$hn, platform:"ubuntu", version:"24"}')
  api devices/enroll POST "$payload" | tee "$STATE_DIR/enroll.json" || true
}

checkin(){
  local inv=$(/usr/local/sis/inventory.sh)
  local info=$(jq -n --arg ts "$(date -Is)" --argjson inv "$inv" '{time:$ts, inventory:$inv}')
  api devices/checkin POST "$info" >/dev/null || true
}

apply_policies(){
  local pol=$(api devices/policies GET 2>/dev/null || echo '{}')
  echo "$pol" > "$STATE_DIR/policies.json" || true
  /usr/local/sis/apply-wifi.sh "$pol" || true
  /usr/local/sis/apply-proxy.sh "$pol" || true
  /usr/local/sis/apply-certs.sh "$pol" || true
  /usr/local/sis/apply-printers.sh "$pol" || true
  /usr/local/sis/apply-restrictions.sh "$pol" || true
}

self_update(){
  # Pull latest agent bundle from server if provided
  local bundle_url=$(api client/bundle-url GET 2>/dev/null || echo '')
  if [[ -n "$bundle_url" ]]; then
    tmp=$(mktemp)
    curl -fsSL "$bundle_url" -o "$tmp" && sudo bash "$tmp" || true
    rm -f "$tmp"
  fi
}

write_provision(){
  # stdin: JSON with student/teacher/admin and wifi/mdm settings
  install -d -m 0755 /etc/sis
  cat > /etc/sis/provision.json
  chmod 0600 /etc/sis/provision.json
}

case "${1:-}" in
  enroll) enroll;;
  checkin) checkin;;
  apply) apply_policies;;
  self-update) self_update;;
  write-provision) write_provision;;
  *) echo "Usage: mdm-agent.sh enroll|checkin|apply|self-update|write-provision"; exit 2;;
 esac
