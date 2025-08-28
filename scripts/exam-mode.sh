#!/usr/bin/env bash
set -euo pipefail
# Lockdown baseline: block hotkeys, disable BT, external displays; allowlist apps
MODE=${1:-on}
case "$MODE" in
  on)
    # Disable Bluetooth
    systemctl stop bluetooth || true
    rfkill block bluetooth || true
    # Kill screen capture tools (best effort)
    pkill -f flameshot || true
    # TODO: set xkb options to disable Alt+Tab etc (environment-dependent)
    touch /tmp/sis-exam-mode
    ;;
  off)
    rfkill unblock bluetooth || true
    systemctl start bluetooth || true
    rm -f /tmp/sis-exam-mode || true
    ;;
  *) echo "Usage: exam-mode.sh on|off"; exit 2;;
 esac
