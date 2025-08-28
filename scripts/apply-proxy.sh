#!/usr/bin/env bash
set -euo pipefail
J="$1"; [[ -z "${J:-}" && -f /etc/sis/provision.json ]] && J=$(cat /etc/sis/provision.json)
HTTP=$(echo "$J" | jq -r '.proxy.http // empty')
HTTPS=$(echo "$J" | jq -r '.proxy.https // empty')
NO_PROXY=$(echo "$J" | jq -r '.proxy.no_proxy // "localhost,127.0.0.1,::1"')

if [[ -n "$HTTP" || -n "$HTTPS" ]]; then
  cat >/etc/apt/apt.conf.d/99sis-proxy.conf <<CONF
Acquire::http::Proxy "${HTTP}";
Acquire::https::Proxy "${HTTPS:-$HTTP}";
CONF
  cat >/etc/profile.d/sis-proxy.sh <<CONF
export http_proxy=${HTTP}
export https_proxy=${HTTPS:-$HTTP}
export no_proxy=${NO_PROXY}
CONF
  chmod 0644 /etc/profile.d/sis-proxy.sh
  echo "[proxy] applied"
fi
