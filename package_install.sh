#!/bin/bash

# SIST UI Project - Package Installer
# This script installs all necessary dependencies for the SIST UI.
# It should be run with sudo privileges.

echo "--- Starting SIST UI Dependency Installation ---"

# --- System Package Installation ---
echo "Updating package lists..."
sudo apt-get update

echo "Installing essential system packages and command-line tools..."
sudo apt-get install -y \
    xfwm4 \
    picom \
    python3 \
    python3-pip \
    python3-psutil \
    alsa-utils \
    pulseaudio-utils \
    pavucontrol \
    wireplumber \
    wmctrl \
    zenity \
    kdialog \
    brightnessctl \
    acpi \
    upower \
    network-manager \
    nm-tray \
    bluez \
    bluez-tools \
    playerctl \
    gnome-screenshot \
    grim \
    slurp \
    xdg-utils \
    gvfs \
    gvfs-backends \
    libgtk-3-dev \
    npm \
    rustup \
    libwebkit2gtk-4.1-dev

# Optional app ecosystem
sudo apt-get install -y flatpak || true

rustup default stable
# --- Python Library Installation ---
echo "Installing required Python libraries via pip..."
echo "pip3 install -q requests xmltodict raylib"

echo "--- Dependency installation complete. ---"

# Hints for non-GNOME desktop environments
echo ""
echo "Notes:"
echo "- On KDE, volume/brightness may be controlled via different services."
echo "- For XFCE wallpaper control, you may need: xfconf-query (package: xfconf)."
echo "- For Wayland screenshot: grim + slurp are installed."
