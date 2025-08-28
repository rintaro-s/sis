#!/usr/bin/env bash
set -euo pipefail
# Usage: apply-wifi.sh <json>  or read from /etc/sis/provision.json
J="$1"; [[ -z "${J:-}" && -f /etc/sis/provision.json ]] && J=$(cat /etc/sis/provision.json)
SSID=$(echo "$J" | jq -r '.wifi.ssid // empty')
PASS=$(echo "$J" | jq -r '.wifi.password // empty')
SEC=$(echo "$J" | jq -r '.wifi.security // "wpa-psk"')
if [[ -z "$SSID" ]]; then echo "[wifi] no SSID"; exit 0; fi
set +e
nmcli c show "$SSID" >/dev/null 2>&1; EXISTS=$?
set -e
if [[ $EXISTS -eq 0 ]]; then nmcli c delete "$SSID" || true; fi
if [[ "$SEC" == "wpa-psk" ]]; then
  nmcli d wifi connect "$SSID" password "$PASS" || nmcli c add type wifi ifname "*" con-name "$SSID" ssid "$SSID" && nmcli c modify "$SSID" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS"
else
  # EAP/enterprise等の拡張は後日
  nmcli d wifi connect "$SSID" password "$PASS" || true
fi
echo "[wifi] configured $SSID"
