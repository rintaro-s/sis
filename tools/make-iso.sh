#!/usr/bin/env bash
set -euo pipefail

# Build a custom Ubuntu ISO using live-build

if [[ ${EUID} -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

ROOT_DIR=$(readlink -f "$(dirname "$0")/..")
CONFIG_DIR="$ROOT_DIR/live-build-config"

cd "$CONFIG_DIR"

# Build the ISO
lb build

# Move the resulting ISO to the dist directory
mv live-image-amd64.hybrid.iso "$ROOT_DIR/dist/sis-os-ubuntu24-custom.iso"

echo "Built: $ROOT_DIR/dist/sis-os-ubuntu24-custom.iso"