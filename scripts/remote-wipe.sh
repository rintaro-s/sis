#!/usr/bin/env bash
set -euo pipefail
# Triggered by systemd .path when /etc/sis/REMOTE_WIPE or MDM order exists
FLAG="/etc/sis/REMOTE_WIPE"
if [[ -f "$FLAG" ]]; then
  echo "[wipe] remote wipe requested"
  # Best-effort secure erase of user homes and local data (do not touch bootloader)
  for u in /home/*; do
    [[ -d "$u" ]] || continue
    shred -u -z -n 1 "$u"/* 2>/dev/null || true
  done
  # Clear cached credentials
  rm -rf /var/cache/* /var/tmp/* 2>/dev/null || true
  echo "[wipe] done; powering off"
  systemctl poweroff || true
fi
