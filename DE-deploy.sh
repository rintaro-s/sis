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
  1) 依存導入: gnome-shell, gnome-session-bin, xwayland, xdg-desktop-portal(-gtk), wmctrl, x11-utils, xdotool, libnotify-bin, playerctl, brightnessctl, network-manager, bluez, gnome-shell-extension-just-perfection, libwebkit2gtk-4.1-0 など
  2) sis-ui の .deb ビルド/インストール（try-deploy.sh）
  3) /etc/xdg/autostart/sis-ui.desktop の配置（SISUIデスクトップで常駐）
  4) GDM セッション登録: Wayland/Xorg 用の「SIS UI」「SIS UI (Xorg)」エントリ
  5) GNOME Dock を自動非表示へ推奨設定（ユーザ gsettings。パネルは保持）
  6) NetworkManager / Bluetooth サービスの有効化
  7) Openbox ベースの「SIS UI (Minimal)」セッション追加（picom/dunst/polkit/nm-applet/blueman/locker の自動起動）
  8) 完了メッセージとロールバック覚書の提示
DRY
  exit 0
fi

log "[1/8] 依存パッケージの更新/導入 (Ubuntu 24+ GNOME)"
$SUDO apt-get update -y
$SUDO apt-get install -y \
  gnome-shell gnome-session-bin \
  xwayland xdg-desktop-portal xdg-desktop-portal-gtk \
  wmctrl x11-utils xdotool libnotify-bin \
  playerctl brightnessctl \
  network-manager bluez \
  gnome-shell-extension-just-perfection || true

# WebView依存（ディストリによりバージョンが異なる）
$SUDO apt-get install -y libwebkit2gtk-4.1-0 || \
  $SUDO apt-get install -y libwebkit2gtk-4.0-37 || true

# 旧XFCE系の自動起動を削除（過去の実行で残っている場合に備えて）
if [[ -f /etc/xdg/autostart/picom.desktop ]]; then $SUDO rm -f /etc/xdg/autostart/picom.desktop || true; fi
if [[ -f /etc/xdg/picom.conf ]]; then $SUDO rm -f /etc/xdg/picom.conf || true; fi

log "[2/8] sis-ui のパッケージをビルド/インストール (.deb)"
[[ -x "$TRY_DEPLOY" ]] || die "try-deploy.sh not found."
"$TRY_DEPLOY"

command -v sis-ui >/dev/null 2>&1 || {
  log "sis-ui バイナリが PATH に見つかりません。/usr/bin/sis-ui を生成します。"
  if [[ -x /usr/bin/app ]]; then
    $SUDO ln -sf /usr/bin/app /usr/bin/sis-ui
  elif [[ -x /opt/sis-ui/sis-ui ]]; then
    $SUDO install -m 0755 /dev/stdin /usr/bin/sis-ui <<'EOF'
#!/usr/bin/env bash
exec /opt/sis-ui/sis-ui "$@"
EOF
  else
    # 最後の手段: Tauri出力候補から探索
    CAND=$(ls -1t /opt/sis-ui/* 2>/dev/null | head -n1 || true)
    if [[ -n "$CAND" && -x "$CAND" ]]; then
      $SUDO ln -sf "$CAND" /usr/bin/sis-ui
    else
      die "sis-ui 実行ファイルを特定できませんでした。dpkgの出力をご確認ください。"
    fi
  fi
}

# 互換: /usr/bin/app も存在させておく（古いショートカット対策）
if [[ ! -x /usr/bin/app ]]; then
  if [[ -x /usr/bin/sis-ui ]]; then
    $SUDO ln -sf /usr/bin/sis-ui /usr/bin/app || true
  fi
fi

log "[3/8] GNOME セッションでの自動起動を設定"
$SUDO install -d -m 0755 /etc/xdg/autostart
$SUDO tee /etc/xdg/autostart/sis-ui.desktop >/dev/null <<'EOF'
[Desktop Entry]
Type=Application
Name=SIS UI
Comment=Smart Interface System UI
Exec=/usr/bin/sis-ui
Icon=sis-ui
X-GNOME-Autostart-enabled=true
# All desktops so通常のGNOMEでも常駐可能（セッション切替と両立）
OnlyShowIn=SISUI;GNOME;Unity;Pantheon;XFCE;LXQt;MATE;
X-GNOME-Autostart-Phase=Initialization
NoDisplay=false
EOF

log "[4/8] GDM ログインに SIS UI セッションを追加 (Wayland/Xorg)"
$SUDO install -d -m 0755 /usr/share/wayland-sessions /usr/share/xsessions

# 旧エントリを片付け
$SUDO rm -f /usr/share/wayland-sessions/sis-ui-gnome.desktop || true
$SUDO rm -f /usr/share/xsessions/sis-ui-gnome-xorg.desktop || true

# Wayland セッション（通常の Ubuntu GNOME と同等の起動。SIS UI は自動起動で常駐）
$SUDO tee /usr/share/wayland-sessions/sis-ui.desktop >/dev/null <<'EOF'
[Desktop Entry]
Name=SIS UI
Comment=GNOME (Wayland) session with SIS UI desktop
Exec=env XDG_CURRENT_DESKTOP=SISUI:GNOME GNOME_SHELL_SESSION_MODE=ubuntu /usr/bin/gnome-session --session=ubuntu
TryExec=/usr/bin/gnome-session
Type=Application
DesktopNames=SISUI;GNOME
X-GDM-SessionRegisters=true
EOF

# Xorg セッション（互換用）
$SUDO tee /usr/share/xsessions/sis-ui-xorg.desktop >/dev/null <<'EOF'
[Desktop Entry]
Name=SIS UI (Xorg)
Comment=GNOME on Xorg with SIS UI desktop
Exec=env XDG_CURRENT_DESKTOP=SISUI:GNOME /usr/bin/gnome-session --session=ubuntu
TryExec=/usr/bin/gnome-session
Type=Application
DesktopNames=SISUI;GNOME
X-GDM-SessionRegisters=true
EOF

log "[5/8] GNOME の推奨設定（Dock を自動非表示に／パネルは保持）"
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

log "[6/8] サービス確認 (NetworkManager / Bluetooth)"
$SUDO systemctl enable --now NetworkManager.service || true
$SUDO systemctl enable --now bluetooth.service || true

# ユーザー systemd で sis-ui を自動再起動（クラッシュ時の復帰）
log "[6.5/8] ユーザー systemd サービス（自動再起動）"
if command -v systemctl >/dev/null 2>&1; then
  SVC=~/.config/systemd/user/sis-ui.service
  mkdir -p ~/.config/systemd/user
  cat > "$SVC" <<'UNIT'
[Unit]
Description=SIS UI Desktop Shell
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/sis-ui
Restart=always
RestartSec=2
Environment=XDG_CURRENT_DESKTOP=SISUI

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload || true
  systemctl --user enable --now sis-ui.service || true
fi

log "[7/8] SIS UI (Minimal) セッションを追加 (Openboxベース)"
# 追加パッケージ: openbox, picom, dunst, polkit, nm-applet, blueman, locker
$SUDO apt-get install -y openbox obconf picom dunst policykit-1-gnome network-manager-gnome blueman light-locker xss-lock || true

$SUDO tee /usr/share/xsessions/sis-ui-openbox.desktop >/dev/null <<'EOF'
[Desktop Entry]
Name=SIS UI (Minimal)
Comment=Openbox session with SIS UI desktop
Exec=env XDG_CURRENT_DESKTOP=SISUI /usr/bin/openbox-session
TryExec=/usr/bin/openbox-session
Type=Application
DesktopNames=SISUI
X-GDM-SessionRegisters=true
EOF

# Openboxシステム全体のautostartに、SIS UIと周辺デーモンを登録（GNOMEとは干渉しない）
$SUDO install -d -m 0755 /etc/xdg/openbox
$SUDO tee /etc/xdg/openbox/autostart >/dev/null <<'EOF'
# Openbox global autostart for SIS UI minimal session
export XDG_CURRENT_DESKTOP=SISUI

# Ensure DBus env is propagated (best effort)
if command -v dbus-update-activation-environment >/dev/null 2>&1; then
  dbus-update-activation-environment --systemd --all || true
fi

# Start services (avoid duplicates)
(pidof picom >/dev/null) || picom &
(pidof dunst >/dev/null) || dunst &
(pidof nm-applet >/dev/null) || nm-applet &
(pidof blueman-applet >/dev/null) || blueman-applet &
(pidof xss-lock >/dev/null) || xss-lock -- light-locker-command -l &
(pgrep -f polkit-gnome-authentication-agent-1 >/dev/null) || \
  /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1 &

# Launch SIS UI
(pidof sis-ui >/dev/null) || /usr/bin/sis-ui &
EOF

log "[8/8] 完了"
cat <<'MSG'
- ログアウト→ログイン画面で「SIS UI」または「SIS UI (Xorg)」セッションを選択できます（GNOMEが管理、SIS UIは自動常駐）。
- SIS UI は「SIS UI」セッションでのみ自動起動します（既定のUbuntuセッションには影響しません）。
- すぐに起動する: /usr/bin/sis-ui
- Dockは自動非表示に設定済みです（必要に応じてGNOME設定で調整できます）。

補足: Waylandでグローバルショートカットが塞がれている場合の回避
- GNOMEのカスタムショートカットで Ctrl+P → 'sis-ui --toggle-palette'、Ctrl+Shift+7 → 'sis-ui --toggle-terminal' を割当にすると確実です。
  例: gsettings を使うスクリプトを後日提供します。

[ロールバック覚書]
- GNOME Dock: gsettings reset-recursively org.gnome.shell.extensions.dash-to-dock
- 自動起動の無効化: rm -f /etc/xdg/autostart/sis-ui.desktop
MSG
