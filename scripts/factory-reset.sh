#!/usr/bin/env bash
set -euo pipefail
echo "[reset] factory reset starting"
systemctl stop sis-ui.service 2>/dev/null || true
rm -rf /etc/sis/provision.json /var/lib/sis-* /home/*/.config/sis 2>/dev/null || true
find /home -maxdepth 1 -mindepth 1 -type d -exec bash -lc 'user=$(basename "$1"); [[ "$user" != "root" ]] && deluser --remove-home "$user" 2>/dev/null || true' _ {} \;
echo "[reset] done. Please reinstall or rerun install.sh"
