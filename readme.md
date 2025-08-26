
# SIS UI

- 「使う人」の為のデスクトップ環境です。  
- React + Tauri で作ってます。  
- ローカルのLLMサーバー（例: LMstudio, Ollama, llama.cppサーバー）と連携して、チャットやコマンド生成ができます。  
- まだ全部はできてないけど、だいたい動くところは動きます。

## できること（現状）

- ホーム画面でアプリやフォルダをカードで並べて起動できる
- コマンドパレット（Ctrl+P）でAIに「○○して」って言うとコマンドを生成してくれる
- 内蔵ターミナル（Ctrl+Shift+7）でコマンドを直接実行できる（危ないコマンドは弾く）
- GNOMEやXfceのセッションとして自動起動できる（DE-deploy.sh で全部やってくれる）
- ショートカット（SuperキーやCtrl+Pなど）でどこからでもPaletteやTerminalを開ける（WaylandはGNOMEカスタムショートカット推奨）
- 災害情報（地震・避難指示）を定期取得して通知（saigai.py 参照）

## 技術的な話

- フロント：React + TypeScript + Vite
- バックエンド：Tauri（Rust）
- LLMはローカルサーバー（llama.cpp系やOllama等）にHTTPで投げてるだけ
- セッション/自動起動/再起動はDE-deploy.shで全部やる
- コマンドパレットやターミナルはTauriのinvoke経由でRust側に投げてる
- 災害情報はPythonスクリプトで取得してる（saigai.py）

## 使い方（ざっくり）

1. 依存パッケージ入れる（package_install.sh）
2. ビルド（`cd sis-ui && npm ci && npm run build`）
3. DEとしてインストールせずに試用する：try-deploy.sh
4. DEとして全部セットアップ：`sudo ./DE-deploy.sh`

- GNOMEやXfceのセッションで「SIS UI」を選ぶと自動起動します
- 普通のGNOMEでも常駐できる（autostart）

## LLMサーバーの設定

- LMstudioみたいなローカルサーバーを自分で用意して、`gemma-3-12b-it-Q4_K_M.gguf`みたいなモデルを置いてください
- バックエンドは `llm_query` コマンドでサーバーに投げてます
- LMstudioやOllamaも使えるようにする予定

## よくある操作

- Ctrl+P：コマンドパレット
- Ctrl+Shift+7：内蔵ターミナル
- Superキー：円形メニュー（予定）
- Alt+Space：ランチャー（予定）

## 追加予定（まだ未実装）

- スマホ通知ミラーリング
- スマホカメラをWebカメラ化
- タブレットをサブディスプレイ化
- Google Classroom / Teams連携
- AIによるチャット内容の自動チェック・警告
- 管理モード（GIGAスクール向けの生徒/教師切替）
- フレンド登録・LAN内チャット/ファイル共有
- 姿勢チェック・ウイルスチェック（ON/OFF可）
- RaylibオーバーレイUI（今はfeatureフラグのみ）

## 注意

- まだ開発中なので、壊れてるところや未実装多いです
- LLMサーバーは自分で立ててください
- GNOMEのグローバルショートカットはWaylandだと制限あり。カスタムショートカット推奨