#!/usr/bin/env bash
set -euo pipefail
log(){ echo "[fscrypt] $*"; }
# Provide a baseline to enable fscrypt on ext4/xfs for per-user encryption (does not reformat)
if ! command -v fscrypt >/dev/null 2>&1; then
  sudo apt-get install -y fscrypt || exit 0
fi
# Non-interactive setup if possible
if [[ -f /etc/fscrypt.conf ]]; then exit 0; fi
sudo fscrypt setup || true
# Administrator can later run: fscrypt encrypt /home/<user> --user=<user>
log "fscrypt baseline initialized. To encrypt home directories, enroll keys via MDM or manual."
