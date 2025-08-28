#!/usr/bin/env bash
set -euo pipefail
HOST=$(hostname)
OS=$(grep PRETTY_NAME /etc/os-release | cut -d= -f2- | tr -d '"')
KERNEL=$(uname -r)
CPU=$(lscpu | awk -F: '/Model name/ {print $2}' | xargs)
MEM=$(grep MemTotal /proc/meminfo | awk '{print $2" KB"}')
IP=$(hostname -I 2>/dev/null | xargs || true)
MAC=$(ip link show | awk '/link\/ether/ {print $2}' | paste -sd, -)
jq -n --arg host "$HOST" --arg os "$OS" --arg kernel "$KERNEL" --arg cpu "$CPU" --arg mem "$MEM" --arg ip "$IP" --arg mac "$MAC" '{host:$host,os:$os,kernel:$kernel,cpu:$cpu,mem:$mem,ip:$ip,mac:$mac}'
