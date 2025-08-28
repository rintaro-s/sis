#!/usr/bin/env bash
set -euo pipefail
# PoC: Live 環境でAPを立て、簡易プロビジョンAPIを起動

SSID="SIS-Setup-$(tr -dc A-Z0-9 </dev/urandom | head -c 5)"
PASS="P$(tr -dc A-Za-z0-9 </dev/urandom | head -c 11)"
NETIF=${NETIF:-wlan0}

cat <<EOT
SSID: $SSID
PASS: $PASS
URL : http://192.168.50.1:5000/provision
EOT

ip link set "$NETIF" down || true
ip addr flush dev "$NETIF" || true
ip link set "$NETIF" up || true

cat >/tmp/hostapd.conf <<AP
interface=$NETIF
driver=nl80211
ssid=$SSID
hw_mode=g
channel=6
wpa=2
wpa_passphrase=$PASS
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
AP

cat >/tmp/dnsmasq.conf <<DNS
interface=$NETIF
bind-interfaces
dhcp-range=192.168.50.10,192.168.50.150,12h
dhcp-option=3,192.168.50.1
dhcp-option=6,192.168.50.1
DNS

ip addr add 192.168.50.1/24 dev "$NETIF" || true
dnsmasq --conf-file=/tmp/dnsmasq.conf --no-daemon &
HOSTAPD_PIDFILE=/tmp/hostapd.pid
hostapd -P "$HOSTAPD_PIDFILE" /tmp/hostapd.conf &

# Minimal Flask app for /provision (uses system python if available)
cat >/tmp/provision.py <<'PY'
from flask import Flask, request, jsonify
import os, json
app = Flask(__name__)
@app.post('/provision')
def provision():
    data = request.get_json(force=True)
    os.makedirs('/etc/sis', exist_ok=True)
    with open('/etc/sis/provision.json','w') as f:
        json.dump(data, f)
    return jsonify({'ok': True})
app.run(host='0.0.0.0', port=5000)
PY

python3 /tmp/provision.py
