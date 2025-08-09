#!/bin/bash

# SIST UI 開発環境が正しくセットアップされているか確認するスクリプト

# 色の定義
COLOR_GREEN='\033[0;32m'
COLOR_RED='\033[0;31m'
COLOR_YELLOW='\033[1;33m'
COLOR_NC='\033[0m' # No Color

# チェック結果のカウンター
CHECKS_TOTAL=0
CHECKS_PASSED=0

# ヘッダーを表示
echo -e "${COLOR_YELLOW}--- SIST UI 開発環境 健康診断を開始します ---${COLOR_NC}"
echo ""

# チェック用の関数
# check_command [コマンド名] [説明]
check_command() {
  ((CHECKS_TOTAL++))
  printf "%-35s" "$2 ($1)"
  if command -v $1 &> /dev/null
  then
    echo -e "[ ${COLOR_GREEN}OK${COLOR_NC} ]"
    ((CHECKS_PASSED++))
  else
    echo -e "[ ${COLOR_RED}NG${COLOR_NC} ]"
  fi
}

# pkg-configでライブラリの存在をチェックする関数
# check_pkg [パッケージ名] [説明]
check_pkg() {
  ((CHECKS_TOTAL++))
  printf "%-35s" "$2 ($1)"
  if pkg-config --exists $1
  then
    echo -e "[ ${COLOR_GREEN}OK${COLOR_NC} ]"
    ((CHECKS_PASSED++))
  else
    echo -e "[ ${COLOR_RED}NG${COLOR_NC} ]"
  fi
}


# --- 1. 基本的な開発ツール ---
echo "--- 1. 基本的な開発ツール ---"
check_command "git" "バージョン管理ツール"
check_command "gcc" "C言語コンパイラ"
check_command "g++" "C++言語コンパイラ"
check_command "cmake" "ビルドシステム"
check_command "pkg-config" "ライブラリ管理ツール"
echo ""

# --- 2. XfceとUI関連 ---
echo "--- 2. XfceとUI関連の部品 ---"
check_pkg "xfce4-ui-2" "Xfce UIライブラリ"
check_pkg "xfce4-panel-2.0" "Xfce パネルライブラリ"
check_pkg "xfconf-0" "Xfce 設定ライブラリ"
check_command "picom" "画面合成エフェクト"
check_pkg "raylib" "グラフィックライブラリ"
echo ""

# --- 3. Tauri関連 ---
echo "--- 3. Tauri関連の部品 ---"
check_command "rustc" "Rustコンパイラ"
check_command "cargo" "Rustパッケージマネージャ"
check_command "node" "Node.js ランタイム"
check_command "npm" "Node.js パッケージマネージャ"
check_pkg "webkit2gtk-4.0" "Tauri Webビュー"
check_pkg "gtk+-3.0" "Tauri UIツールキット"
echo ""

# --- 4. AI (LLM) 関連 ---
echo "--- 4. AI (LLM) 関連の部品 ---"
check_command "nvcc" "NVIDIA CUDAコンパイラ"
echo ""

# --- 5. データベースとパッケージング ---
echo "--- 5. データベースとパッケージング関連 ---"
check_command "sqlite3" "データベース"
check_command "dpkg-deb" "debパッケージ作成ツール"
echo ""

# --- 診断結果のまとめ ---
echo -e "${COLOR_YELLOW}--- 診断結果 ---${COLOR_NC}"
if [ $CHECKS_TOTAL -eq $CHECKS_PASSED ]; then
  echo -e "${COLOR_GREEN}おめでとう！すべての項目が正常にインストールされています！${COLOR_NC}"
  echo "これで安心して SIST UI の開発を始められるね！"
else
  echo -e "${COLOR_RED}いくつかの項目が見つかりませんでした。（${CHECKS_PASSED}/${CHECKS_TOTAL} 項目がOK）${COLOR_NC}"
  echo "上のリストで[ NG ]になっている項目を確認して、"
  echo "もう一度インストールスクリプトを実行するか、個別にインストールしてみてね。"
fi
echo "----------------"