#!/usr/bin/env bash
set -euo pipefail
. /etc/sis/sis.conf 2>/dev/null || true
log(){ echo "[dns-filter] $*"; }

if ! command -v apt-get >/dev/null 2>&1; then echo "apt not found"; exit 0; fi
sudo apt-get install -y dnscrypt-proxy nftables || true

# Use built-in resolver names shipped with dnscrypt-proxy (avoids crafting sdns stamps)
UPSTREAM_NAME=${SIS_DNS_UPSTREAM_NAME:-quad9-doh-ip4-port443}
sudo tee /etc/dnscrypt-proxy/dnscrypt-proxy.toml >/dev/null <<CONF
server_names = ["${UPSTREAM_NAME}"]
require_dnssec = true
listen_addresses = ["127.0.2.1:53"]
max_clients = 250
user_name = "_dnscrypt-proxy"
CONF

sudo systemctl enable --now dnscrypt-proxy || true

# Point system resolver to dnscrypt-proxy (NetworkManager stub resolver)
if grep -q "^DNS=" /etc/systemd/resolved.conf 2>/dev/null; then
  sudo sed -i 's/^#\?DNS=.*/DNS=127.0.2.1/g' /etc/systemd/resolved.conf || true
  sudo systemctl restart systemd-resolved || true
fi

# Block outbound DNS except to localhost and trusted upstream via nftables
sudo tee /etc/nftables.d/90-sis-dns.nft >/dev/null <<'NFT'
add table inet sis
add chain inet sis output { type filter hook output priority 0; }
add rule inet sis output udp dport 53 ip daddr != 127.0.2.1 drop
add rule inet sis output tcp dport 53 ip daddr != 127.0.2.1 drop
NFT

sudo bash -lc 'if ! grep -q "/etc/nftables.d/" /etc/nftables.conf 2>/dev/null; then echo -e "flush ruleset\ninclude \"/etc/nftables.d/*.nft\"" | tee /etc/nftables.conf; fi'
sudo systemctl enable --now nftables || true
sudo nft -f /etc/nftables.conf || true

log "DNS filter baseline applied (ensure upstream works: ${SIS_DNS_UPSTREAM})"
