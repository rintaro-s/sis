#!/usr/bin/env bash
set -euo pipefail

# Fail-friendly logging
log() { echo -e "[deploy] $*"; }
die() { echo -e "[deploy][ERROR] $*" >&2; exit 1; }

# NOTE:
# 事前に Tauri バイナリをビルドしておき、生成物を同梱して .deb を作ります。

# --- Configuration ---
APP_ID="sis-ui"
APP_NAME="SIS UI"
VERSION="0.1.0"
ARCH="${ARCH:-}"
if [[ -z "$ARCH" ]]; then
	ARCH=$(dpkg --print-architecture 2>/dev/null || echo amd64)
fi
MAINTAINER="Your Name <your-email@example.com>"
DESCRIPTION="A light, modern, game-inspired desktop UI powered by Tauri."

ROOT_DIR=$(cd -- "$(dirname -- "$0")"; pwd)
UI_DIR="$ROOT_DIR/sis-ui"
BUILD_DIR="$ROOT_DIR/build"
PKG_DIR="$BUILD_DIR/${APP_ID}_${VERSION}_${ARCH}"

echo "[1/5] Clean build dir"
rm -rf "$BUILD_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/opt/$APP_ID"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$PKG_DIR/etc/xdg/autostart"

sudo apt remove sis-ui -y || true

echo "[2/5] Build frontend & Tauri app (release)"
# 1. フロントエンド（Vite/React）
pushd "$UI_DIR" >/dev/null
	command -v npm >/dev/null 2>&1 || die "npm not found. Please install Node.js and npm."
	npm ci
	npm run build
popd >/dev/null
# 2. Rust/Tauri ビルド（Linux向け）
# MUST use tauri build to ensure frontend assets are embedded into the binary
pushd "$UI_DIR" >/dev/null
	command -v npx >/dev/null 2>&1 || die "npx not found. Please install Node.js/npm."
	# Limit bundling to deb/rpm to avoid AppImage (linuxdeploy) issues; the binary is still produced under target/release
	npx tauri build --bundles deb,rpm -- --manifest-path "$UI_DIR/src-tauri/Cargo.toml"
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

echo "[3/5] Prefer Tauri-generated .deb if available"
# Try to use Tauri bundler's .deb directly for correct resource wiring
TAURI_DEB=""
# Common output locations by tauri-bundler
TAURI_DEB_CANDIDATES=(
	"$UI_DIR/src-tauri/target/release/bundle/deb" \
	"$UI_DIR/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb" \
	"$UI_DIR/src-tauri/target/debian"
)
for d in "${TAURI_DEB_CANDIDATES[@]}"; do
	if [[ -d "$d" ]]; then
		TAURI_DEB=$(ls -1t "$d"/*.deb 2>/dev/null | head -n1 || true)
		[[ -n "$TAURI_DEB" ]] && break
	fi
done

if [[ -n "$TAURI_DEB" && -f "$TAURI_DEB" ]]; then
	echo "Found Tauri deb: $TAURI_DEB"
	DEB_PATH="$TAURI_DEB"
else
	echo "No Tauri deb found. Staging custom package..."
	echo "[3/5] Stage files"
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
NoDisplay=true
EOF

# アイコン配置（ビルド成果物 or リポジトリのPNGを利用）
	ICON_SRC="$UI_DIR/src-tauri/icons/128x128.png"
	if [[ -f "$ICON_SRC" ]]; then
			install -m 0644 "$ICON_SRC" "$PKG_DIR/usr/share/icons/hicolor/256x256/apps/$APP_ID.png"
	fi

echo "[4/5] Control file & build"
	cat > "$PKG_DIR/DEBIAN/control" <<EOF
Package: $APP_ID
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: $MAINTAINER
Description: $DESCRIPTION
Depends: libc6 (>= 2.31), libgtk-3-0, libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37, xdg-utils
EOF

# postinst: ensure autostart entry for SISUI desktop session
	cat > "$PKG_DIR/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
# Create SISUI autostart entry (visible only in SIS UI desktop session)
install -d -m 0755 /etc/xdg/autostart
cat > /etc/xdg/autostart/sis-ui.desktop <<EOT
[Desktop Entry]
Type=Application
Name=SIS UI
Exec=/usr/bin/sis-ui
Icon=sis-ui
X-GNOME-Autostart-enabled=true
	OnlyShowIn=SISUI;
	NoDisplay=true
EOT
exit 0
EOF
	chmod 0755 "$PKG_DIR/DEBIAN/postinst"

	dpkg-deb --build "$PKG_DIR"
	DEB_PATH="$(realpath "$PKG_DIR.deb")"
	echo "OK: $DEB_PATH"
fi

echo "[5/5] Install package"
if [[ $EUID -ne 0 ]]; then SUDO=sudo; else SUDO=""; fi
$SUDO apt-get update -y
set +e
$SUDO apt-get install -y "$DEB_PATH"
APT_RC=$?
set -e
if [[ $APT_RC -ne 0 ]]; then
	log "apt-get install failed with code $APT_RC. Trying to fix dependencies..."
	set +e
	$SUDO apt -f install -y
	$SUDO dpkg -i "$DEB_PATH"
	APT_RC=$?
	set -e
	[[ $APT_RC -ne 0 ]] && die "Failed to install $DEB_PATH (code $APT_RC)."
fi

# Post-install sanity: ensure wrapper exists
if [[ ! -x "/usr/bin/$APP_ID" ]]; then
	log "/usr/bin/$APP_ID not found; creating wrapper to /opt/$APP_ID/$APP_ID"
	$SUDO install -m 0755 /dev/stdin "/usr/bin/$APP_ID" <<EOF
#!/usr/bin/env bash
exec /opt/$APP_ID/$APP_ID "${1:+$@}"
EOF
fi

# Harden desktop entries: hide from app grid/dock even if tauri bundler installed its own
if [[ -d "/usr/share/applications" ]]; then
	for f in /usr/share/applications/sis-ui*.desktop; do
		if [[ -f "$f" ]]; then
			echo "Patching desktop entry: $f (NoDisplay=true, OnlyShowIn=SISUI;)"
			sudo sed -i 's/^NoDisplay=.*/NoDisplay=true/g' "$f" || true
			sudo sed -i 's/^OnlyShowIn=.*/OnlyShowIn=SISUI;/g' "$f" || true
			grep -q '^NoDisplay=' "$f" || echo 'NoDisplay=true' | sudo tee -a "$f" >/dev/null
			grep -q '^OnlyShowIn=' "$f" || echo 'OnlyShowIn=SISUI;' | sudo tee -a "$f" >/dev/null
		fi
	done
fi

# Offer to launch if GUI environment is detected
GUI_DETECTED=0
if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then GUI_DETECTED=1; fi
echo
if [[ $GUI_DETECTED -eq 1 ]]; then
	LAUNCH_MODE=${LAUNCH_MODE:-user} # user|sudo（既定: user）
	read -r -p "Launch $APP_NAME now? [y/N]: " RESP || true
	case "${RESP:-}" in
		y|Y)
			if [[ "$LAUNCH_MODE" == "sudo" ]]; then
				log "Launching /usr/bin/$APP_ID with sudo (LAUNCH_MODE=sudo) ..."
				nohup sudo "/usr/bin/$APP_ID" >/tmp/${APP_ID}.log 2>&1 &
			else
				log "Launching /usr/bin/$APP_ID (user) ..."
				nohup "/usr/bin/$APP_ID" >/tmp/${APP_ID}.log 2>&1 &
			fi
			sleep 1
			log "Tail /tmp/${APP_ID}.log (Ctrl+C to stop):"; tail -n 50 /tmp/${APP_ID}.log || true
			;;
		*)
			if [[ "$LAUNCH_MODE" == "sudo" ]]; then
				log "You can launch later with: sudo /usr/bin/$APP_ID"
			else
				log "You can launch later with: /usr/bin/$APP_ID"
			fi ;;
	 esac
else
	log "No GUI environment (DISPLAY/WAYLAND_DISPLAY not set). Skipping launch."
	log "Headless test example: Xvfb :99 -screen 0 1280x720x24 & DISPLAY=:99 /usr/bin/$APP_ID"
fi
