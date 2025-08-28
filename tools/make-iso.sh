#!/usr/bin/env bash
set -euo pipefail
# Simple Ubuntu 24.04 Desktop ISO remaster to include SIS installer and UI for live trial
# Usage: ./tools/make-iso.sh [/path/to/ubuntu-24.04.1-desktop-amd64.iso] [--full]

if [[ ${EUID} -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

FULL=0
SRC_ISO=""
for a in "$@"; do
  case "$a" in
    --full) FULL=1;;
    *) SRC_ISO=$(readlink -f "$a");;
  esac
done
if [[ -z "$SRC_ISO" ]]; then
  echo "Usage: $0 /path/to/ubuntu-24.04.1-desktop-amd64.iso [--full]" >&2
  exit 1
fi
WORKDIR=$(readlink -f "$(dirname "$0")/../build-iso-work")
OUTDIR=$(readlink -f "$(dirname "$0")/../dist")
mkdir -p "$WORKDIR" "$OUTDIR"

# Ensure any leftover bind mounts from a previous run are unmounted
ROOTFS_PREV="$WORKDIR/rootfs"
for p in "$ROOTFS_PREV/dev" "$ROOTFS_PREV/proc" "$ROOTFS_PREV/sys"; do
  if [[ -d "$p" ]] && mountpoint -q "$p"; then
    umount -lf "$p" || true
  fi
done

# Set a cleanup trap to unmount in case of early exit
cleanup_mounts() {
  for p in "$ROOTFS_MNT/dev" "$ROOTFS_MNT/proc" "$ROOTFS_MNT/sys"; do
    if [[ -n "${p:-}" ]] && [[ -d "$p" ]] && mountpoint -q "$p"; then
      umount -lf "$p" || true
    fi
  done
}
trap cleanup_mounts EXIT

# Check deps
need_bins=("7z" "xorriso" "rsync" "mksquashfs")
for b in "${need_bins[@]}"; do
  if ! command -v "$b" >/dev/null 2>&1; then
    echo "Missing: $b (sudo apt install p7zip-full xorriso rsync squashfs-tools)" >&2
    exit 1
  fi
done

# Prepare
LIVE_MNT="$WORKDIR/mnt"
EXTRACT="$WORKDIR/extract"
ROOTFS_MNT="$WORKDIR/rootfs"
CUSTOM="$WORKDIR/custom"
ISO_LABEL="SIS_OS_UB24"
OUT_ISO="$OUTDIR/sis-os-ubuntu24-custom.iso"
rm -rf "$LIVE_MNT" "$EXTRACT" "$ROOTFS_MNT" "$CUSTOM"
mkdir -p "$LIVE_MNT" "$EXTRACT" "$ROOTFS_MNT" "$CUSTOM"

# 1) Extract ISO
7z x -y -o"$EXTRACT" "$SRC_ISO" >/dev/null

# 2) Unsquash live filesystem (Ubuntu 24.04.2 changed layout under casper/)
# Prefer minimal.standard.live.squashfs, then minimal.standard.squashfs, then minimal.squashfs, then filesystem.squashfs
SQUASH=""
for cand in \
  casper/minimal.standard.live.squashfs \
  casper/minimal.standard.squashfs \
  casper/minimal.squashfs \
  casper/filesystem.squashfs \
  filesystem.squashfs; do
  if [[ -f "$EXTRACT/$cand" ]]; then SQUASH="$EXTRACT/$cand"; break; fi
done
if [[ -z "$SQUASH" ]]; then
  echo "Could not find a squashfs in known locations (casper/* or root)." >&2
  exit 1
fi
unsquashfs -d "$ROOTFS_MNT" "$SQUASH" >/dev/null

# 3) Inject our project into live root under /opt/sis and a desktop launcher
mkdir -p "$ROOTFS_MNT/opt/sis" "$ROOTFS_MNT/usr/local/bin" "$ROOTFS_MNT/usr/share/applications" "$ROOTFS_MNT/etc/skel/Desktop"
# Copy a minimal subset: top-level scripts + sis-ui built app if exists
SRC_ROOT=$(readlink -f "$(dirname "$0")/..")
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'src-tauri/target' \
  --exclude 'sis-ui/node_modules' --exclude 'build-iso-work' --exclude 'dist' \
  "$SRC_ROOT/" "$ROOTFS_MNT/opt/sis/"

# Try to prebuild sis-ui if dist exists; otherwise leave sources
if [[ -d "$ROOTFS_MNT/opt/sis/sis-ui/dist" ]]; then
  echo "sis-ui dist already present"
fi

# Make an installer launcher
cat > "$ROOTFS_MNT/usr/local/bin/sis-install" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/sis
if [[ -x ./install.sh ]]; then
  gnome-terminal -- bash -lc 'sudo ./install.sh || bash'
else
  gnome-terminal -- bash -lc 'echo install.sh not found in /opt/sis; bash'
fi
EOF
chmod +x "$ROOTFS_MNT/usr/local/bin/sis-install"

cat > "$ROOTFS_MNT/usr/share/applications/sis-install.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=SIS Install
Comment=セットアップを開始します（MDM/ログ/フィルタ等）
Exec=sis-install
Terminal=false
Categories=System;Utility;
EOF
chmod 644 "$ROOTFS_MNT/usr/share/applications/sis-install.desktop"

# Put launcher on desktop for live user (ubuntu)
for d in "$ROOTFS_MNT/etc/skel/Desktop" "$ROOTFS_MNT/home/ubuntu/Desktop"; do
  mkdir -p "$d"
  cp -a "$ROOTFS_MNT/usr/share/applications/sis-install.desktop" "$d/"
  chmod +x "$d/sis-install.desktop" || true
  chown -R 999:999 "$d" 2>/dev/null || true
done

# Optional: autostart sis-ui session bits in live (best-effort)
mkdir -p "$ROOTFS_MNT/etc/xdg/autostart"
cat > "$ROOTFS_MNT/etc/xdg/autostart/sis-ui-live.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=SIS UI (Live)
Exec=sh -lc 'cd /opt/sis/sis-ui && (npm run build >/dev/null 2>&1 || true); ./node_modules/.bin/tauri dev || ./node_modules/.bin/tauri build || true'
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

# Branding: OS name, logo, wallpaper, gsettings defaults
mkdir -p "$ROOTFS_MNT/usr/share/backgrounds/sisuntu" "$ROOTFS_MNT/usr/share/pixmaps"
if [[ -f "$ROOTFS_MNT/opt/sis/scripts/image/wallpaper.png" ]]; then
  cp -a "$ROOTFS_MNT/opt/sis/scripts/image/wallpaper.png" "$ROOTFS_MNT/usr/share/backgrounds/sisuntu/wallpaper.png"
fi
if [[ -f "$ROOTFS_MNT/opt/sis/scripts/image/logo.png" ]]; then
  cp -a "$ROOTFS_MNT/opt/sis/scripts/image/logo.png" "$ROOTFS_MNT/usr/share/pixmaps/sis-logo.png"
  # Try to override ubuntu-logo (best effort)
  cp -a "$ROOTFS_MNT/opt/sis/scripts/image/logo.png" "$ROOTFS_MNT/usr/share/pixmaps/ubuntu-logo.png" 2>/dev/null || true
fi

# GNOME defaults: set wallpaper via schema overrides
mkdir -p "$ROOTFS_MNT/usr/share/glib-2.0/schemas"
cat > "$ROOTFS_MNT/usr/share/glib-2.0/schemas/99-sis.gschema.override" <<'GS'
[org.gnome.desktop.background]
picture-uri='file:///usr/share/backgrounds/sisuntu/wallpaper.png'
picture-uri-dark='file:///usr/share/backgrounds/sisuntu/wallpaper.png'
GS

# Compile gsettings schemas in chroot if a shell exists (best-effort)
if [[ -x "$ROOTFS_MNT/bin/sh" || -x "$ROOTFS_MNT/bin/bash" || -x "$ROOTFS_MNT/usr/bin/bash" ]]; then
  mkdir -p "$ROOTFS_MNT/dev" "$ROOTFS_MNT/proc" "$ROOTFS_MNT/sys"
  mount --bind /dev  "$ROOTFS_MNT/dev"
  mount --bind /proc "$ROOTFS_MNT/proc"
  mount --bind /sys  "$ROOTFS_MNT/sys"
  chroot "$ROOTFS_MNT" /bin/sh -lc 'command -v glib-compile-schemas >/dev/null 2>&1 && glib-compile-schemas /usr/share/glib-2.0/schemas || true' || true
  umount -lf "$ROOTFS_MNT/dev" || true
  umount -lf "$ROOTFS_MNT/proc" || true
  umount -lf "$ROOTFS_MNT/sys" || true
else
  echo "[warn] shell not found in live root; skipping schema compile (will compile on target)." >&2
fi

# OS release override (system reads /etc/os-release if present)
cat > "$ROOTFS_MNT/etc/os-release" <<'OR'
NAME="Sisuntu"
PRETTY_NAME="Sisuntu (based on Ubuntu 24.04)"
ID=sisuntu
ID_LIKE=ubuntu
VERSION="24.04"
VERSION_ID="24.04"
HOME_URL="https://example.local/sisuntu"
SUPPORT_URL="https://example.local/sisuntu/support"
BUG_REPORT_URL="https://example.local/sisuntu/issues"
LOGO=sis-logo
OR

# First boot installer (skip in live via casper condition)
cat > "$ROOTFS_MNT/etc/systemd/system/sis-firstboot.service" <<'UNIT'
[Unit]
Description=Run SIS installer on first boot
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/run/casper
ConditionPathExists=!/var/lib/sis/firstboot.done

[Service]
Type=oneshot
RemainAfterExit=no
ExecStart=/bin/bash -lc '/opt/sis/install.sh && mkdir -p /var/lib/sis && touch /var/lib/sis/firstboot.done || true'

[Install]
WantedBy=multi-user.target
UNIT
mkdir -p "$ROOTFS_MNT/etc/systemd/system/multi-user.target.wants"
ln -sf ../sis-firstboot.service "$ROOTFS_MNT/etc/systemd/system/multi-user.target.wants/sis-firstboot.service"

# GDM: set default session to sis-ui-xorg.desktop and disable Wayland by default
mkdir -p "$ROOTFS_MNT/etc/gdm3"
cat > "$ROOTFS_MNT/etc/gdm3/custom.conf" <<'GDM'
[daemon]
# Enforce Xorg and set default session to SIS UI (Xorg)
WaylandEnable=false
DefaultSession=sis-ui-xorg.desktop
GDM

# Provide sis-ui-xorg desktop entry proactively (minimal), DE-deploy will overwrite with full one
mkdir -p "$ROOTFS_MNT/usr/share/xsessions"
cat > "$ROOTFS_MNT/usr/share/xsessions/sis-ui-xorg.desktop" <<'XS'
[Desktop Entry]
Name=SIS UI (Xorg)
Comment=GNOME on Xorg with SIS UI desktop
Exec=env XDG_CURRENT_DESKTOP=SISUI:GNOME /usr/bin/gnome-session --session=ubuntu
TryExec=/usr/bin/gnome-session
Type=Application
DesktopNames=SISUI;GNOME
XS

# 3.5) Optional: FULL mode — install GPU/MDM related packages and enable timers (chroot)
if [[ $FULL -eq 1 ]]; then
  echo "[FULL] Installing GPU/MDM packages inside live root..."
  if [[ -x "$ROOTFS_MNT/bin/sh" || -x "$ROOTFS_MNT/bin/bash" || -x "$ROOTFS_MNT/usr/bin/bash" ]]; then
    mkdir -p "$ROOTFS_MNT/dev" "$ROOTFS_MNT/proc" "$ROOTFS_MNT/sys"
    mount --bind /dev  "$ROOTFS_MNT/dev"
    mount --bind /proc "$ROOTFS_MNT/proc"
    mount --bind /sys  "$ROOTFS_MNT/sys"
    chroot "$ROOTFS_MNT" /bin/sh -lc "set -e; export DEBIAN_FRONTEND=noninteractive; \
    apt-get update -y; \
    apt-get install -y --no-install-recommends \
      ubuntu-drivers-common linux-firmware mesa-vulkan-drivers vulkan-tools \
      vainfo vdpauinfo firmware-amd-graphics || true; \
    # NVIDIA (best-effort; will only work on supported hardware at install time)
    ubuntu-drivers autoinstall || true; \
    # MDM/system bits likely used during live or post-install
    apt-get install -y auditd rsyslog network-manager bluez x11-utils xdotool wmctrl || true; \
    systemctl enable auditd || true; systemctl enable NetworkManager || true; \
    # Place SIS scripts
    mkdir -p /etc/xdg/autostart; \
    cp -a /opt/sis/provisioning/autostart/sis-keys.desktop /etc/xdg/autostart/ 2>/dev/null || true; \
    # One-shot post-live hint
    echo 'SIS FULL: GPU/MDM packages preloaded in live root.' >/etc/sis_full_mode 2>/dev/null || true; \
  " || true
    umount -lf "$ROOTFS_MNT/dev" || true
    umount -lf "$ROOTFS_MNT/proc" || true
    umount -lf "$ROOTFS_MNT/sys" || true
  else
    echo "[warn] shell not found in live root; skipping FULL chroot provisioning." >&2
  fi
fi

# 4) Repack squashfs
# Ensure chroot bind mounts are unmounted before packing
for p in "$ROOTFS_MNT/dev" "$ROOTFS_MNT/proc" "$ROOTFS_MNT/sys"; do
  if mountpoint -q "$p"; then umount -lf "$p" || true; fi
done
rm -f "$SQUASH"
mksquashfs "$ROOTFS_MNT" "$SQUASH" -noappend -comp xz >/dev/null

# 5) Build ISO back while reusing original boot setup (replay)
cd "$EXTRACT"
# Update md5sum.txt
if [[ -f md5sum.txt ]]; then
  rm -f md5sum.txt
  find . -type f -print0 | sort -z | xargs -0 md5sum > md5sum.txt || true
fi

# Use xorriso to replay boot parameters from source ISO and map our modified tree
xorriso \
  -indev "$SRC_ISO" \
  -outdev "$OUT_ISO" \
  -volid "$ISO_LABEL" \
  -map "$EXTRACT" / \
  -boot_image any replay

echo "Built: $OUT_ISO"
