#!/usr/bin/env bash
set -euo pipefail
. /etc/sis/sis.conf 2>/dev/null || true
log(){ echo "[snapshot] $*"; }

# Try btrfs, then timeshift (rsync), else noop
if [[ "${SIS_USE_BTRFS:-0}" == "1" && -d /.snapshots ]]; then
  DATE=$(date +%F_%H-%M-%S)
  if command -v btrfs >/dev/null 2>&1; then
    log "Creating btrfs snapshot @ /@-sis-$DATE"
    btrfs subvolume snapshot -r / /@-sis-$DATE || true
    exit 0
  fi
fi
if command -v timeshift >/dev/null 2>&1; then
  sudo timeshift --create --comments "pre-upgrade $(date)" || true
  exit 0
fi
log "No snapshot backend available (skipping)"
