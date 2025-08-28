#!/usr/bin/env bash
set -euo pipefail
# Minimal first-boot wizard placeholder
FLAG=/var/lib/sis-zerotouch.done
[[ -f "$FLAG" ]] && exit 0
# Here you would prompt Wi-Fi join, enroll to MDM, import certs, then mark done
/usr/local/sis/mdm-agent.sh enroll || true
mkdir -p "$(dirname "$FLAG")" && touch "$FLAG"
