#!/bin/bash

# SIST UI 開発環境を整えるためのスクリプトだよ！
# 最初に一度だけ実行してね。

echo "--- SIST UI 開発環境のセットアップを開始します ---"

# --- Step 1: 基本の道具箱をそろえる ---
echo "Step 1: 基本的な開発ツールをインストールしています..."
sudo apt update
sudo apt install -y build-essential git cmake curl wget file pkg-config

# --- Step 2: Xfceと見た目の魔法の部品 ---
echo "Step 2: Xfce, Picom, Raylib関連の部品をインストールしています..."
sudo apt install -y xfce4-dev-tools libxfce4ui-2-dev libxfce4panel-2.0-dev libxfconf-0-dev
sudo apt install -y picom libconfig-dev libdbus-1-dev libegl1-mesa-dev libev-dev libx11-xcb-dev libxcb-damage0-dev libxcb-dpms0-dev libxcb-glx0-dev libxcb-image0-dev libxcb-present-dev libxcb-randr0-dev libxcb-render0-dev libxcb-render-util0-dev libxcb-shape0-dev libxcb-util-dev libxcb-xfixes0-dev libxext-dev meson ninja-build uthash-dev
sudo apt install -y libraylib-dev

# --- Step 3: Tauriくんのお家 ---
echo "Step 3: Tauriが必要とする部品をインストールしています..."
sudo apt install -y libwebkit2gtk-4.0-dev libssl-dev libgtk-3-dev librsvg2-dev

# --- Step 4: Rustのインストール (公式のrustupを使うよ！) ---
if ! command -v rustc &> /dev/null
then
    echo "Step 4: Rustをインストールします。 (aptではなく、公式のrustupを使います)"
    echo "途中で選択肢が出たら「1」を入力してエンターを押してね。"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "Rustのインストールが完了しました！"
else
    echo "Step 4: Rustはすでにインストールされています。"
fi

# --- Step 5: Node.jsのインストール (最新版を使うよ！) ---
if ! command -v node &> /dev/null
then
    echo "Step 5: Node.jsをインストールします..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt install -y nodejs
    echo "Node.jsのインストールが完了しました！"
else
    echo "Step 5: Node.jsはすでにインストールされています。"
fi

# --- Step 6: AIの心臓部 (NVIDIA CUDA) ---
# お兄ちゃんのすごいGPU(RTX5070ti)のためにCUDAをインストール！
if ! command -v nvcc &> /dev/null
then
    echo "Step 6: NVIDIA CUDA Toolkitをインストールします。少し時間がかかるよ！"
    # この部分は、NVIDIAの公式手順に基づいているよ
    wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
    sudo dpkg -i cuda-keyring_1.1-1_all.deb
    sudo apt update
    sudo apt -y install cuda-toolkit-12-5
    rm cuda-keyring_1.1-1_all.deb
    
    echo 'export PATH="/usr/local/cuda/bin${PATH:+:${PATH}}"' >> ~/.bashrc
    echo 'export LD_LIBRARY_PATH="/usr/local/cuda/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"' >> ~/.bashrc
    echo "CUDAのインストールが完了しました！"
else
    echo "Step 6: NVIDIA CUDA Toolkitはすでにインストールされているようです。"
fi


# --- Step 7: データベースとパッケージ作りの道具 ---
echo "Step 7: SQLiteとdebパッケージ作成ツールをインストールしています..."
sudo apt install -y sqlite3 libsqlite3-dev
sudo apt install -y dpkg-dev debhelper

echo ""
echo "--- すべてのセットアップが完了しました！ ---"
echo "RustとCUDAの環境変数を読み込むために、一度ターミナルを再起動するか、"
echo "次のコマンドを実行してください:"
echo ""
echo "  source ~/.bashrc"
echo ""
echo "これで、SIST UIの開発準備は万端だよ！"