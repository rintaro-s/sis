#!/usr/bin/env bash
set -euo pipefail
# Placeholder for offline-friendly distribution/collection using syncthing
ACTION=${1:-}
case "$ACTION" in
  distribute)
    echo "Place files in ~/Sync/Distribute and they will sync to students"
    ;;
  collect)
    echo "Collected files will appear in ~/Sync/Collect"
    ;;
  *) echo "Usage: distribute-collect.sh distribute|collect"; exit 2;;
 esac
