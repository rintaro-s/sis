#!/bin/bash

# VirtualBoxのインストールスクリプト

# --- 設定 ---
# Ubuntuのコードネームを設定
# Ubuntu 22.04 LTS: jammy
# Ubuntu 24.04 LTS: noble
# Ubuntu 24.10: oracular
# Debian 12: bookworm
# Debian 11: bullseye
DISTRO="noble"

# インストールするVirtualBoxのバージョンを設定
# 例: virtualbox-7.1
VIRTUALBOX_VERSION="virtualbox-7.1"
# -----------------

# 必要なパッケージをインストール
echo "Installing required packages..."
sudo apt-get update
sudo apt-get install -y wget gpg

# Oracleの公開鍵をダウンロードして登録
echo "Downloading and registering Oracle public key..."
wget -O- https://www.virtualbox.org/download/oracle_vbox_2016.asc | sudo gpg --yes --output /usr/share/keyrings/oracle-virtualbox-2016.gpg --dearmor

# aptリポジトリを追加
echo "Adding VirtualBox repository..."
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/oracle-virtualbox-2016.gpg] https://download.virtualbox.org/virtualbox/debian ${DISTRO} contrib" | sudo tee /etc/apt/sources.list.d/virtualbox.list > /dev/null

# パッケージリストを更新してVirtualBoxをインストール
echo "Updating package list and installing VirtualBox..."
sudo apt-get update
sudo apt-get install -y "$VIRTUALBOX_VERSION"

echo "Installation complete!"