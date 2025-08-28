#!/usr/bin/env bash
set -euo pipefail
. /etc/sis/sis.conf 2>/dev/null || true
log(){ echo "[sso] $*"; }

# Baseline for SSSD/realmd enrollment (domain join is environment-specific)
sudo apt-get install -y realmd sssd sssd-tools libnss-sss libpam-sss adcli oddjob oddjob-mkhomedir packagekit || true

# Enable mkhomedir on login
if ! sudo pam-auth-update --list | grep -q mkhomedir; then
  echo "session required pam_mkhomedir.so skel=/etc/skel/ umask=0077" | sudo tee /etc/pam.d/common-session-local >/dev/null
fi

log "SSO baseline installed. To join domain: realm join <domain> --user=<admin>"
