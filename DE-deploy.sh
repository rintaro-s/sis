#!/usr/bin/env bash
set -euo pipefail

log() { echo -e "[de-deploy] $*"; }
die() { echo -e "[de-deploy][ERROR] $*" >&2; exit 1; }

# このスクリプトは「簡易DEとして使う」ための前提パッケージ導入と設定、
# そして sis-ui の .deb インストールまでを行います。
# Xfceベース（xfwm4 + picom）を最小限導入します。

if [[ $EUID -ne 0 ]]; then SUDO=sudo; else SUDO=""; fi

ROOT_DIR=$(cd -- "$(dirname -- "$0")"; pwd)
TRY_DEPLOY="$ROOT_DIR/try-deploy.sh"

command -v apt-get >/dev/null 2>&1 || die "apt-get is required on Debian/Ubuntu based systems"

log "[1/6] 基本パッケージの更新/導入"
$SUDO apt-get update -y
$SUDO apt-get install -y \
  xfwm4 picom xfce4-terminal xfce4-settings \
  network-manager bluez pulseaudio alsa-utils playerctl brightnessctl \
  libgtk-3-0 libwebkit2gtk-4.1-0 || \
  $SUDO apt-get install -y libwebkit2gtk-4.0-37 || true

log "[2/6] 最小のセッション・オートスタート設定"
# Xsession 例: xfwm4 + picom + sis-ui を起動
$SUDO install -d -m 0755 /etc/skel/.config/autostart
$SUDO install -d -m 0755 /etc/xdg/autostart

$SUDO tee /etc/xdg/autostart/picom.desktop >/dev/null <<'EOF'
[Desktop Entry]
Type=Application
Name=Picom (Compositor)
Exec=picom --experimental-backends --config /etc/xdg/picom.conf
X-GNOME-Autostart-enabled=true
OnlyShowIn=XFCE;
EOF

$SUDO tee /etc/xdg/picom.conf >/dev/null <<'EOF'
backend = "glx";
vsync = true;
corner-radius = 12;
round-borders = 1;
blur-method = "gaussian";
blur-strength = 5;
EOF

# xfwm4 は Xfce セッションで自動起動されるため、ここでは sis-ui の自動起動を確保
$SUDO tee /etc/xdg/autostart/sis-ui.desktop >/dev/null <<'EOF'
[Desktop Entry]
Type=Application
Name=SIS UI (Autostart)
Exec=/usr/bin/sis-ui
Icon=sis-ui
X-GNOME-Autostart-enabled=true
OnlyShowIn=XFCE;
NoDisplay=false
EOF

log "[3/6] ログイン時にXが立ち上がらない場合のヘルプ (任意)"
cat <<'NOTE'
- ディスプレイマネージャが無い環境では、sshやttyから startx / xinit を使ってXを起動できます。
- 最小xinitrc例 (~/.xinitrc):
    #!/bin/sh
    picom --experimental-backends &
    xfwm4 &
    sis-ui
    exec tail -f /dev/null
NOTE

log "[4/6] sis-ui のパッケージをビルド/インストール"
[[ -x "$TRY_DEPLOY" ]] || die "try-deploy.sh not found."
"$TRY_DEPLOY"

log "[5/6] サウンド・ネットワークサービス確認"
$SUDO systemctl enable --now NetworkManager.service || true
$SUDO systemctl enable --now bluetooth.service || true
$SUDO systemctl --user enable --now pulseaudio.service 2>/dev/null || true

log "[6/6] 完了: ログイン後に SIS UI が自動起動します (XFCEセッション)"
echo "- GUI 環境ならログアウト/ログイン、または reboot 後に自動起動します。"
echo "- すぐ起動する: /usr/bin/sis-ui"
