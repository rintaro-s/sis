#!/usr/bin/env bash
set -euo pipefail
# Prepare Veyon profiles (teacher/student roles placeholder)
ROLE=${1:-student}
if ! command -v veyon-cli >/dev/null 2>&1; then echo "Veyon not installed"; exit 0; fi
if [[ "$ROLE" == "teacher" ]]; then
  veyon-cli authkeys create teacher default || true
else
  veyon-cli authkeys create student default || true
fi
