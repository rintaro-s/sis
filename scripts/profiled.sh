#!/usr/bin/env bash
set -euo pipefail
. /etc/sis/sis.conf 2>/dev/null || true
CMD=${1:-}
now_hhmm=$(date +%H%M)
within_class() {
  local s=${SIS_CLASS_START_HHMM:-0830}
  local e=${SIS_CLASS_END_HHMM:-1630}
  [[ "$now_hhmm" > "$s" && "$now_hhmm" < "$e" ]]
}
case "$CMD" in
  upgrade)
    if within_class; then echo "[upgrade] within class window ($SIS_CLASS_START_HHMM-$SIS_CLASS_END_HHMM), skipping"; exit 0; fi
    /usr/local/sis/pre-update-snapshot.sh || true
    sudo unattended-upgrades -d || true
    ;;
  *) echo "Usage: profiled.sh upgrade"; exit 2;;
 esac
