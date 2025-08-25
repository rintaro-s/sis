#!/usr/bin/env bash
set -euo pipefail

log() { echo -e "[de-deploy] $*"; }
die() { echo -e "[de-deploy][ERROR] $*" >&2; exit 1; }

# Ubuntu 24+ GNOME Desktop を前提に、SIS UI を「DEとして」導入します。
# 具体的には:
# - 依存パッケージ導入（Wayland/X11 両対応のため xwayland, wmctrl, xprop 等）
# - sis-ui のビルド/インストール（.deb）
# - GNOME セッションでの自動起動（/etc/xdg/autostart）
# - GDM ログインに「SIS UI (GNOME)」セッションを追加（任意利用）
# - GNOME Dock（Ubuntu Dock）の自動非表示推奨設定（ユーザgsettings、可能な範囲）

if [[ $EUID -ne 0 ]]; then SUDO=sudo; else SUDO=""; fi

ROOT_DIR=$(cd -- "$(dirname -- "$0")"; pwd)
TRY_DEPLOY="$ROOT_DIR/try-deploy.sh"

command -v apt-get >/dev/null 2>&1 || die "apt-get is required on Debian/Ubuntu based systems"

# オプション: --dry-run で実際の変更を行わず工程のみ表示
if [[ "${1:-}" == "--dry-run" || "${SIS_DRY_RUN:-}" == "1" ]]; then
  cat <<'DRY'
[dry-run] 以下を実行予定です（変更は行いません）:
  1) 依存導入: gnome-shell, gnome-session-bin, xwayland, xdg-desktop-portal(-gtk), wmctrl, x11-utils, playerctl, brightnessctl, network-manager, bluez, libwebkit2gtk-4.1-0
  2) sis-ui の .deb ビルド/インストール（try-deploy.sh）
  3) /etc/xdg/autostart/sis-ui.desktop の配置（GNOME起動時に常駐）
  4) GDM セッション登録: wayland/xorg 用の SIS UI (GNOME) エントリ
  5) GNOME Dock の自動非表示を推奨設定
  6) NetworkManager / Bluetooth サービスの有効化
DRY
  exit 0
fi

log "[1/7] 依存パッケージの更新/導入 (Ubuntu 24+ GNOME)"
$SUDO apt-get update -y
$SUDO apt-get install -y \
  gnome-shell gnome-session-bin \
  xwayland xdg-desktop-portal xdg-desktop-portal-gtk \
  wmctrl x11-utils \
  playerctl brightnessctl \
  network-manager bluez \
  libwebkit2gtk-4.1-0 || \
  $SUDO apt-get install -y libwebkit2gtk-4.0-37 || true

# 旧XFCE系の自動起動を削除（過去の実行で残っている場合に備えて）
if [[ -f /etc/xdg/autostart/picom.desktop ]]; then $SUDO rm -f /etc/xdg/autostart/picom.desktop || true; fi
if [[ -f /etc/xdg/picom.conf ]]; then $SUDO rm -f /etc/xdg/picom.conf || true; fi

log "[2/7] sis-ui のパッケージをビルド/インストール (.deb)"
[[ -x "$TRY_DEPLOY" ]] || die "try-deploy.sh not found."
"$TRY_DEPLOY"

command -v sis-ui >/dev/null 2>&1 || {
  log "sis-ui バイナリが PATH に見つかりません。/usr/bin/sis-ui を確認します。"
  [[ -x /usr/bin/sis-ui ]] || die "sis-ui のインストールに失敗しています。"
}

log "[3/7] GNOME セッションでの自動起動を設定"
$SUDO install -d -m 0755 /etc/xdg/autostart
$SUDO tee /etc/xdg/autostart/sis-ui.desktop >/dev/null <<'EOF'
[Desktop Entry]
Type=Application
Name=SIS UI
Comment=Smart Interface System UI
Exec=/usr/bin/sis-ui
Icon=sis-ui
X-GNOME-Autostart-enabled=true
OnlyShowIn=SISUI;
X-GNOME-Autostart-Phase=Initialization
NoDisplay=false
EOF

log "[4/7] GDM ログインに SIS UI (GNOME) セッションを追加 (Wayland/X11)"
$SUDO install -d -m 0755 /usr/share/wayland-sessions /usr/share/xsessions

# Wayland セッション（通常の Ubuntu GNOME と同等の起動。SIS UI は自動起動で常駐）
$SUDO tee /usr/share/wayland-sessions/sis-ui-gnome.desktop >/dev/null <<'EOF'
[Desktop Entry]
Name=SIS UI (GNOME)
Comment=GNOME session with SIS UI desktop
Exec=env XDG_CURRENT_DESKTOP=SISUI:GNOME GNOME_SHELL_SESSION_MODE=ubuntu /usr/bin/gnome-session --session=ubuntu
TryExec=/usr/bin/gnome-session
Type=Application
DesktopNames=SISUI;GNOME
X-GDM-SessionRegisters=true
EOF

# Xorg セッション（互換用）
$SUDO tee /usr/share/xsessions/sis-ui-gnome-xorg.desktop >/dev/null <<'EOF'
[Desktop Entry]
Name=SIS UI (GNOME on Xorg)
Comment=GNOME on Xorg with SIS UI desktop
Exec=env XDG_CURRENT_DESKTOP=SISUI:GNOME /usr/bin/gnome-session --session=ubuntu
TryExec=/usr/bin/gnome-session
Type=Application
DesktopNames=SISUI;GNOME
X-GDM-SessionRegisters=true
EOF

log "[5/7] GNOME の推奨設定（Ubuntu Dock を自動非表示に）"
apply_gsettings() {
  local user="$1"
  local cmd_prefix=(sudo -u "$user" dbus-launch gsettings)
  # Dock 自動非表示/インテリハイド
  "${cmd_prefix[@]}" set org.gnome.shell.extensions.dash-to-dock dock-fixed false || true
  "${cmd_prefix[@]}" set org.gnome.shell.extensions.dash-to-dock autohide true || true
  "${cmd_prefix[@]}" set org.gnome.shell.extensions.dash-to-dock intellihide true || true
}

if [[ -n "${SUDO_USER:-}" ]]; then
  log "- 現在のsudo呼び出しユーザー(${SUDO_USER})に対して gsettings を適用"
  apply_gsettings "$SUDO_USER" || true
else
  # 直接実行された場合、現在ユーザーに適用
  if command -v gsettings >/dev/null 2>&1; then
    log "- 現在のユーザーに対して gsettings を適用"
    gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed false || true
    gsettings set org.gnome.shell.extensions.dash-to-dock autohide true || true
    gsettings set org.gnome.shell.extensions.dash-to-dock intellihide true || true
  else
    log "- gsettings が見つからないためスキップしました"
  fi
fi

log "[6/7] サービス確認 (NetworkManager / Bluetooth)"
$SUDO systemctl enable --now NetworkManager.service || true
$SUDO systemctl enable --now bluetooth.service || true

log "[7/7] 完了"
cat <<'MSG'
- ログアウト→ログイン画面で「SIS UI (GNOME)」セッションを選択できます（通常のUbuntu GNOMEと同等に起動し、SIS UIは自動常駐）。
- そのまま既定のセッションでも、SIS UI は GNOME で自動起動します。
- すぐに起動する: /usr/bin/sis-ui
- Dockは自動非表示に設定済みです（必要に応じてGNOME設定で調整できます）。
MSG
