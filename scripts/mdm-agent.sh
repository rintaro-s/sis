#!/usr/bin/env bash
set -euo pipefail
. /etc/sis/sis.conf 2>/dev/null || true
log(){ echo "[mdm] $*"; }

API="${SIS_MDM_URL:-}"
TOKEN="${SIS_MDM_TOKEN:-}"
STATE_DIR="/var/lib/sis-mdm"; sudo install -d -m 0755 "$STATE_DIR"
DEVICE_ID=""; DEVICE_TOKEN=""
if [[ -f "$STATE_DIR/enroll.json" ]]; then
  DEVICE_ID=$(jq -r '.device_id? // empty' "$STATE_DIR/enroll.json" 2>/dev/null || true)
  DEVICE_TOKEN=$(jq -r '.device_token? // empty' "$STATE_DIR/enroll.json" 2>/dev/null || true)
fi

api() { # path method data_json -> stdout
  local path="$1"; shift
  local method="${1:-GET}"; shift || true
  local data="${1:-}"
  [[ -z "$API" ]] && { log "MDM URL not configured"; return 1; }
  curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X "$method" "${API%/}/$path" ${data:+--data "$data"}
}

dev_headers(){
  [[ -z "$DEVICE_ID" || -z "$DEVICE_TOKEN" ]] && return 1
  echo -H "X-Device-ID: $DEVICE_ID" -H "X-Device-Token: $DEVICE_TOKEN"
}

enroll(){
  local hostname=$(hostname)
  local payload=$(jq -n --arg hn "$hostname" '{hostname:$hn, platform:"ubuntu", version:"24"}')
  curl -fsSL -H 'Content-Type: application/json' -X POST "${API%/}/devices/enroll" --data "$payload" | tee "$STATE_DIR/enroll.json" || true
  DEVICE_ID=$(jq -r '.device_id? // empty' "$STATE_DIR/enroll.json" 2>/dev/null || true)
  DEVICE_TOKEN=$(jq -r '.device_token? // empty' "$STATE_DIR/enroll.json" 2>/dev/null || true)
}

checkin(){
  local inv=$(/usr/local/sis/inventory.sh)
  local info=$(jq -n --arg ts "$(date -Is)" --argjson inv "$inv" '{time:$ts, inventory:$inv}')
  curl -fsSL $(dev_headers) -H 'Content-Type: application/json' -X POST "${API%/}/devices/checkin" --data "$info" >/dev/null || true
}

apply_policies(){
  local pol=$(curl -fsSL $(dev_headers) "${API%/}/devices/policies" 2>/dev/null || echo '{}')
  echo "$pol" > "$STATE_DIR/policies.json" || true
  # 生徒向け可視化ビューも同期
  local view=$(curl -fsSL "${API%/}/policies/view?deviceId=$DEVICE_ID" 2>/dev/null || echo '{}')
  echo "$view" > "$STATE_DIR/policies_view.json" || true
  /usr/local/sis/apply-wifi.sh "$pol" || true
  /usr/local/sis/apply-proxy.sh "$pol" || true
  /usr/local/sis/apply-certs.sh "$pol" || true
  /usr/local/sis/apply-printers.sh "$pol" || true
  /usr/local/sis/apply-restrictions.sh "$pol" || true
}

telemetry(){
  # ポリシーに応じて軽量なテレメトリを送信（同意ベース）
  local pol_path="$STATE_DIR/policies.json"
  [[ ! -f "$pol_path" ]] && return 0
  local web_hist=$(jq -r '.monitoring.web_history // false' "$pol_path" 2>/dev/null || echo false)
  local images_meta=$(jq -r '.monitoring.images // false' "$pol_path" 2>/dev/null || echo false)
  if [[ "$web_hist" == "true" ]]; then
    local tmp=$(mktemp)
    /usr/local/sis/collect-web-history.sh "$tmp" || echo '[]' > "$tmp"
    local payload=$(jq -n --argjson items "$(cat "$tmp")" '{type:"web_history", items:$items}')
    curl -fsSL $(dev_headers) -H 'Content-Type: application/json' -X POST "${API%/}/telemetry/upload" --data "$payload" >/dev/null || true
    rm -f "$tmp"
  fi
  if [[ "$images_meta" == "true" ]]; then
    local tmp=$(mktemp)
    /usr/local/sis/scrape-images.sh "$HOME" > "$tmp" 2>/dev/null || echo '[]' > "$tmp"
    # サイズや件数のみ集計して送信
    local count=$(jq 'length' "$tmp" 2>/dev/null || echo 0)
    local payload=$(jq -n --argjson count "$count" '{type:"images_meta", count:$count}')
    curl -fsSL $(dev_headers) -H 'Content-Type: application/json' -X POST "${API%/}/telemetry/upload" --data "$payload" >/dev/null || true
    rm -f "$tmp"
  fi
}

poll_commands(){
  local cmds=$(curl -fsSL $(dev_headers) -H 'Content-Type: application/json' -X POST "${API%/}/devices/commands/poll" --data '{}' 2>/dev/null || echo '{"commands":[]}')
  echo "$cmds" | jq -c '.commands[]? // empty' | while read -r c; do
    local action=$(echo "$c" | jq -r '.action')
    case "$action" in
      lock_screens)
        loginctl lock-sessions || true ;;
      message)
        local text=$(echo "$c" | jq -r '.args.text // ""')
        command -v notify-send >/dev/null && notify-send "SIS" "$text" || echo "$text" ;;
      run)
        local cmd=$(echo "$c" | jq -r '.args.cmd // ""')
        bash -lc "$cmd" || true ;;
      screenshot)
        /usr/local/sis/screen-record.sh shot || true ;;
    esac
  done
}

send_screenshot(){
  local out="/tmp/sis-shot-$$.png"
  /usr/local/sis/screen-record.sh shot "$out" || exit 0
  curl -fsSL $(dev_headers) -F "file=@$out" "${API%/}/devices/screenshot" || true
  rm -f "$out"
}

pull_files(){
  local list=$(curl -fsSL $(dev_headers) "${API%/}/files/pending" 2>/dev/null || echo '{"files":[]}')
  echo "$list" | jq -c '.files[]? // empty' | while read -r f; do
    local id=$(echo "$f" | jq -r '.id')
    local name=$(echo "$f" | jq -r '.name')
    local url="${API%/}/files/download/$id"
    curl -fsSL "$url" -o "/home/$USER/Downloads/$name" || true
  done
}

submit_file(){
  # mdm-agent.sh submit-file /path/to/file
  local path="$1"; [[ -z "${path:-}" ]] && { echo "usage: mdm-agent.sh submit-file FILE"; exit 2; }
  curl -fsSL $(dev_headers) -F "file=@$path" "${API%/}/files/collect" || true
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
  poll) poll_commands;;
  screenshot) send_screenshot;;
  pull-files) pull_files;;
  submit-file) submit_file "$2";;
  telemetry) telemetry;;
  write-provision) write_provision;;
  *) echo "Usage: mdm-agent.sh enroll|checkin|apply|self-update|poll|screenshot|pull-files|submit-file <file>|telemetry|write-provision"; exit 2;;
 esac
