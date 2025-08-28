#!/usr/bin/env bash
set -euo pipefail
PASS=${1:-}
if ! command -v x11vnc >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y x11vnc || true
fi
if [[ -z "$PASS" ]]; then PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 10); fi
echo "$PASS" > /tmp/.x11vnc_pass
x11vnc -storepasswd "$PASS" /tmp/x11vnc.pass || true
DISPLAY=${DISPLAY:-:0} nohup x11vnc -display "$DISPLAY" -rfbauth /tmp/x11vnc.pass -forever -shared -nopw -rfbport 5900 >/var/log/sis/x11vnc.log 2>&1 &
echo "[remote] VNC started on port 5900, password: $PASS"
