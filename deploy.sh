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

echo "[2/4] Build Tauri app (release)"
pushd "$UI_DIR" >/dev/null
	# Node deps / build
	npm ci
	npm run build
	# Tauri build (Linux向け)
	npx tauri build --target x86_64-unknown-linux-gnu
popd >/dev/null

# 生成物の場所（Tauri v2, Vite構成の標準）
APP_OUT_DIR="$UI_DIR/src-tauri/target/x86_64-unknown-linux-gnu/release"
BIN_PATH="$APP_OUT_DIR/sis-ui"
RES_DIR="$APP_OUT_DIR/bundle/resources"

if [[ ! -f "$BIN_PATH" ]]; then
	echo "Tauri binary not found: $BIN_PATH" >&2
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
Depends: libc6 (>= 2.31)
EOF

dpkg-deb --build "$PKG_DIR"
echo "OK: $(realpath "$PKG_DIR.deb")"
