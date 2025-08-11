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
    brightnessctl \
    network-manager \
    bluez \
    playerctl \
    gnome-screenshot \
    xdg-utils

# --- Python Library Installation ---
echo "Installing required Python libraries via pip..."
pip3 install -q requests xmltodict raylib raygui tauri

echo "--- Dependency installation complete. ---"
