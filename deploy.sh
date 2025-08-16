#!/usr/bin/env bash
set -euo pipefail

# NOTE:
# このスクリプトは Ubuntu 実機でのみ実行してください（Windows では動作しません）。
# 事前に Tauri バイナリをビルドしておき、生成物を同梱して .deb を作ります。

# --- Configuration ---
APP_ID="sis-ui"
APP_NAME="SIS UI"
VERSION="0.1.0"
ARCH="amd64"   # 他: arm64 等
MAINTAINER="Your Name <your-email@example.com>"
DESCRIPTION="A light, modern, game-inspired desktop UI powered by Tauri."

ROOT_DIR=$(cd -- "$(dirname -- "$0")"; pwd)
UI_DIR="$ROOT_DIR/sis-ui"
BUILD_DIR="$ROOT_DIR/build"
PKG_DIR="$BUILD_DIR/${APP_ID}_${VERSION}_${ARCH}"

echo "[1/4] Clean build dir"
rm -rf "$BUILD_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/opt/$APP_ID"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$PKG_DIR/etc/xdg/autostart"

echo "[2/4] Build frontend & Tauri app (release)"
# 1. フロントエンド（Vite/React）
pushd "$UI_DIR" >/dev/null
	npm ci
	npm run build
popd >/dev/null
# 2. Rust/Tauri ビルド（Linux向け）
# Use cargo build --release directly to produce the binary and avoid tauri-bundler bundling step
# If you need to cross-compile, set CROSS_TARGET (e.g. x86_64-unknown-linux-gnu) in the environment
pushd "$UI_DIR" >/dev/null
if [[ -n "${CROSS_TARGET:-}" ]]; then
	echo "Building for target $CROSS_TARGET"
	cargo build --release --manifest-path src-tauri/Cargo.toml --target "$CROSS_TARGET"
else
	cargo build --release --manifest-path src-tauri/Cargo.toml
fi
popd >/dev/null

# 生成物の場所: 複数の候補ディレクトリをチェックして、最初に見つかったバイナリを使う
APP_OUT_CANDIDATES=(
	"$UI_DIR/src-tauri/target/x86_64-unknown-linux-gnu/release"
	"$UI_DIR/src-tauri/target/release"
	"$UI_DIR/src-tauri/target/release/deps"
)

BIN_PATH=""
RES_DIR=""
for d in "${APP_OUT_CANDIDATES[@]}"; do
	if [[ -d "$d" ]]; then
		# Prefer named binaries
		if [[ -f "$d/app" ]]; then
			BIN_PATH="$d/app"
			RES_DIR="$d/bundle/resources"
			break
		fi
		if [[ -f "$d/sis-ui" ]]; then
			BIN_PATH="$d/sis-ui"
			RES_DIR="$d/bundle/resources"
			break
		fi

		# Pick first executable regular file as fallback
		CANDIDATE=$(find "$d" -maxdepth 1 -type f -perm /111 -print -quit || true)
		if [[ -n "$CANDIDATE" ]]; then
			BIN_PATH="$CANDIDATE"
			RES_DIR="$d/bundle/resources"
			break
		fi
	fi
done

if [[ -z "$BIN_PATH" || ! -f "$BIN_PATH" ]]; then
	echo "Tauri binary not found in any expected output directories:" >&2
	for d in "${APP_OUT_CANDIDATES[@]}"; do
		echo "--- $d ---" >&2
		ls -la "$d" >&2 || true
	done
	exit 1
fi

echo "[3/4] Stage files"
# 実行ファイルとリソース（アイコン等）
install -m 0755 "$BIN_PATH" "$PKG_DIR/opt/$APP_ID/$APP_ID"
if [[ -d "$RES_DIR" ]]; then
	cp -a "$RES_DIR/." "$PKG_DIR/opt/$APP_ID/"
fi

# 起動シェル（/usr/bin 下にエイリアス）
cat > "$PKG_DIR/usr/bin/$APP_ID" <<'EOF'
#!/usr/bin/env bash
exec /opt/sis-ui/sis-ui "$@"
EOF
chmod +x "$PKG_DIR/usr/bin/$APP_ID"

# .desktop エントリ
cat > "$PKG_DIR/usr/share/applications/$APP_ID.desktop" <<EOF
[Desktop Entry]
Name=$APP_NAME
Exec=$APP_ID
Icon=$APP_ID
Type=Application
Categories=Utility;
Terminal=false
EOF

# アイコン配置（ビルド成果物 or リポジトリのPNGを利用）
ICON_SRC="$UI_DIR/src-tauri/icons/128x128.png"
if [[ -f "$ICON_SRC" ]]; then
	install -m 0644 "$ICON_SRC" "$PKG_DIR/usr/share/icons/hicolor/256x256/apps/$APP_ID.png"
fi

echo "[4/4] Control file & build"
cat > "$PKG_DIR/DEBIAN/control" <<EOF
Package: $APP_ID
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: $MAINTAINER
Description: $DESCRIPTION
Depends: libc6 (>= 2.31), libgtk-3-0, libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37, xfwm4, picom, python3, python3-pip, python3-psutil, alsa-utils, brightnessctl, network-manager, bluez, playerctl, gnome-screenshot, xdg-utils
EOF

# postinst: ensure pip libs (best-effort) and autostart entry
cat > "$PKG_DIR/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
# Create Xfce autostart entry
install -d -m 0755 /etc/xdg/autostart
cat > /etc/xdg/autostart/sis-ui.desktop <<EOT
[Desktop Entry]
Type=Application
Name=SIS UI (Autostart)
Exec=/usr/bin/sis-ui
Icon=sis-ui
X-GNOME-Autostart-enabled=true
OnlyShowIn=XFCE;
NoDisplay=false
EOT
exit 0
EOF
chmod 0755 "$PKG_DIR/DEBIAN/postinst"

dpkg-deb --build "$PKG_DIR"
echo "OK: $(realpath "$PKG_DIR.deb")"
