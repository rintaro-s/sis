#!/bin/bash
# SIST UI Project - Deployment Script
# This script packages the SIST UI into a .deb file.

# --- Configuration ---
PACKAGE_NAME="sist-ui"
VERSION="0.1.0"
ARCHITECTURE="all"
MAINTAINER="Your Name <your-email@example.com>"
DESCRIPTION="A revolutionary desktop environment with AI integration."

# --- Build Directory Setup ---
BUILD_DIR="./build"
PACKAGE_DIR="${BUILD_DIR}/${PACKAGE_NAME}_${VERSION}_${ARCHITECTURE}"

rm -rf "${BUILD_DIR}"
mkdir -p "${PACKAGE_DIR}/DEBIAN"
mkdir -p "${PACKAGE_DIR}/usr/bin"
mkdir -p "${PACKAGE_DIR}/usr/lib/sist"
mkdir -p "${PACKAGE_DIR}/usr/share/applications"
mkdir -p "${PACKAGE_DIR}/usr/share/icons"
mkdir -p "${PACKAGE_DIR}/usr/share/sist"

# --- Create DEBIAN/control file ---
cat << EOF > "${PACKAGE_DIR}/DEBIAN/control"
Package: ${PACKAGE_NAME}
Version: ${VERSION}
Architecture: ${ARCHITECTURE}
Maintainer: ${MAINTAINER}
Description: ${DESCRIPTION}
Depends: python3, xfwm4, picom
EOF

# --- Copy Application Files ---
cp ./main.py "${PACKAGE_DIR}/usr/lib/sist/"
cp ./saigai.py "${PACKAGE_DIR}/usr/lib/sist/"
cp -r ./theme_assets "${PACKAGE_DIR}/usr/share/sist/"

# --- Create Executable ---
cat << EOF > "${PACKAGE_DIR}/usr/bin/sist"
#!/bin/bash
python3 /usr/lib/sist/main.py
EOF
chmod +x "${PACKAGE_DIR}/usr/bin/sist"

# --- Create .desktop file ---
cat << EOF > "${PACKAGE_DIR}/usr/share/applications/sist.desktop"
[Desktop Entry]
Name=SIST UI
Exec=sist
Icon=/usr/share/icons/sist.png
Type=Application
Categories=Utility;
EOF

# --- Copy Icon ---
cp ./theme_assets/icons/logo.png "${PACKAGE_DIR}/usr/share/icons/sist.png"

# --- Build the .deb package ---
dpkg-deb --build "${PACKAGE_DIR}"

echo "--- Deployment complete. Package created at ${PACKAGE_DIR}.deb ---"
