#!/usr/bin/env bash
set -euo pipefail

# VM helper: build ISO, create disk, install, run, stop, status, tail logs
# Usage examples:
#   ./tools/vm-helper.sh build-iso
#   ./tools/vm-helper.sh install             # ISO から通常インストール（GUI表示）
#   ./tools/vm-helper.sh run                 # インストール済みディスクから起動（GUI表示）
#   ./tools/vm-helper.sh tail                # 直近のシリアルログを確認
#   ./tools/vm-helper.sh stop                # 起動中のQEMUを停止
#   ./tools/vm-helper.sh status              # 稼働状況
#   ./tools/vm-helper.sh clean               # ディスク/ログを掃除（注意）

ROOT_DIR=$(readlink -f "$(dirname "$0")/..")
DIST_DIR="$ROOT_DIR/dist"
BOOT_DIR="$DIST_DIR/boot"
ISO_OUT="$DIST_DIR/sis-os-ubuntu24-custom.iso"
PID_INSTALL="$DIST_DIR/qemu-install.pid"
PID_GUEST="$DIST_DIR/qemu-guest.pid"
MON_INSTALL="$DIST_DIR/qemu-install.monitor"
MON_GUEST="$DIST_DIR/qemu-guest.monitor"
DISK_IMG="$DIST_DIR/sis-test-disk.qcow2"
SER_INSTALL="$BOOT_DIR/qemu-install-serial.log"
SER_GUEST="$BOOT_DIR/qemu-guest-serial.log"
RUN_LOG="$BOOT_DIR/qemu-run.log"

mkdir -p "$DIST_DIR" "$BOOT_DIR"

# Configurable via env
RAM_INSTALL=${RAM_INSTALL:-4096}
CPUS_INSTALL=${CPUS_INSTALL:-2}
RAM_GUEST=${RAM_GUEST:-2048}
CPUS_GUEST=${CPUS_GUEST:-2}
DISK_SIZE=${DISK_SIZE:-20G}
USE_KVM=${USE_KVM:-1}          # 1: enable-kvm, 0: no KVM
QEMU_BIN=${QEMU_BIN:-qemu-system-x86_64}
QEMU_IMG=${QEMU_IMG:-qemu-img}

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 2; }; }

build_iso() {
  echo "[build-iso] Building with live-build..."
  sudo "$ROOT_DIR/tools/make-iso.sh"
  ls -lh "$ISO_OUT"
}

create_disk() {
  need_bin "$QEMU_IMG"
  if [[ -f "$DISK_IMG" ]]; then
    echo "[disk] Exists: $DISK_IMG (skip). To recreate: $0 clean"
  else
    echo "[disk] Creating: $DISK_IMG size=$DISK_SIZE"
    "$QEMU_IMG" create -f qcow2 "$DISK_IMG" "$DISK_SIZE"
  fi
  ls -lh "$DISK_IMG"
}

start_install() {
  need_bin "$QEMU_BIN"
  [[ -f "$ISO_OUT" ]] || { echo "Custom ISO not found: $ISO_OUT. Run: $0 build-iso" >&2; exit 2; }
  create_disk
  rm -f "$SER_INSTALL" "$RUN_LOG" "$PID_INSTALL" "$MON_INSTALL"
  echo "[install] Starting QEMU (GUI). Serial -> $SER_INSTALL"
  local kvm_args=()
  [[ "$USE_KVM" = "1" ]] && kvm_args=( -enable-kvm ) || kvm_args=()
  "$QEMU_BIN" \
    -m "$RAM_INSTALL" -smp "$CPUS_INSTALL" \
    "${kvm_args[@]}" \
    -name "sis-install" \
    -pidfile "$PID_INSTALL" \
    -monitor unix:"$MON_INSTALL",server,nowait \
    -drive file="$DISK_IMG",if=virtio \
    -cdrom "$ISO_OUT" -boot d \
    -device usb-ehci,id=ehci \
    -device usb-tablet \
    -nic user,model=virtio-net-pci \
    -serial file:"$SER_INSTALL" \
    -display default \
    -daemonize
  echo "[install] QEMU pid: $(cat "$PID_INSTALL")"
  echo "Tip: tail -f $SER_INSTALL"
}

start_guest() {
  need_bin "$QEMU_BIN"
  [[ -f "$DISK_IMG" ]] || { echo "Disk not found: $DISK_IMG. Run install first." >&2; exit 2; }
  rm -f "$SER_GUEST" "$PID_GUEST" "$MON_GUEST"
  echo "[run] Booting installed disk (GUI). Serial -> $SER_GUEST"
  local kvm_args=()
  [[ "$USE_KVM" = "1" ]] && kvm_args=( -enable-kvm ) || kvm_args=()
  "$QEMU_BIN" \
    -m "$RAM_GUEST" -smp "$CPUS_GUEST" \
    "${kvm_args[@]}" \
    -name "sis-guest" \
    -pidfile "$PID_GUEST" \
    -monitor unix:"$MON_GUEST",server,nowait \
    -drive file="$DISK_IMG",if=virtio \
    -boot c \
    -device usb-ehci,id=ehci \
    -device usb-tablet \
    -nic user,model=virtio-net-pci \
    -serial file:"$SER_GUEST" \
    -display default \
    -daemonize
  echo "[run] QEMU pid: $(cat "$PID_GUEST")"
  echo "Tip: tail -f $SER_GUEST"
}

stop_all() {
  for pidf in "$PID_INSTALL" "$PID_GUEST"; do
    if [[ -f "$pidf" ]]; then
      local p; p=$(cat "$pidf" || true)
      if [[ -n "${p:-}" ]] && kill -0 "$p" 2>/dev/null; then
        echo "[stop] killing $p"
        kill "$p" || true
      fi
      rm -f "$pidf"
    fi
  done
}

status() {
  for tag in install guest; do
    local pidf="$DIST_DIR/qemu-$tag.pid"
    if [[ -f "$pidf" ]]; then
      local p; p=$(cat "$pidf" || true)
      if [[ -n "${p:-}" ]] && kill -0 "$p" 2>/dev/null; then
        echo "[$tag] running pid=$p"
      else
        echo "[$tag] not running (stale pid file)"
      fi
    else
      echo "[$tag] not running"
    fi
  done
}

tail_logs() {
  for f in "$SER_INSTALL" "$SER_GUEST"; do
    if [[ -f "$f" ]]; then
      echo "--- $f ---"
      tail -n 200 "$f"
    fi
  done
}

clean() {
  stop_all || true
  rm -f "$DISK_IMG" "$SER_INSTALL" "$SER_GUEST" "$RUN_LOG" "$PID_INSTALL" "$PID_GUEST" "$MON_INSTALL" "$MON_GUEST"
  echo "[clean] removed disk and logs"
}

usage() {
  cat <<USAGE
Usage: $0 <command> [args]
  build-iso              Build custom ISO via tools/make-iso.sh (requires sudo)
  install                Start installer from ISO (GUI window)
  run                    Boot installed disk (GUI window)
  stop                   Stop running QEMU VMs
  status                 Show VM status
  tail                   Show last 200 lines of serial logs
  clean                  Remove disk and logs

Env overrides: RAM_INSTALL, CPUS_INSTALL, RAM_GUEST, CPUS_GUEST, DISK_SIZE, USE_KVM (1/0)
USAGE
}

cmd=${1:-}
case "$cmd" in
  build-iso) shift; build_iso;;
  install)   shift; start_install;;
  run)       shift; start_guest;;
  stop)      shift; stop_all;;
  status)    shift; status;;
  tail)      shift; tail_logs;;
  clean)     shift; clean;;
  *) usage; exit 2;;
esac
