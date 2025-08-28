# SIS Unified Setup

このリポジトリは Ubuntu 24+ をベースにした学校向け端末の魔改造セットアップを提供します。

主コマンド: `install.sh`

- 監査/ログ収集、更新管理（授業時間帯回避）、DNSフィルタ、MDMフック、ゼロタッチ初期化、授業系下地（Veyon/試験モード）を一括導入します。
- デスクトップは `DE-deploy.sh` で sis-ui を配備します。

## 使い方

標準導入:

```bash
sudo ./install.sh
```

オプション:

- `--dry-run` 変更なしで工程だけ表示
- `--with-veyon` 授業管理 Veyon を導入
- `--with-syncthing` 配布/回収用 Syncthing を導入
- `--no-ui` デスクトップ配備をスキップ

## ISO 化（計画）

1. Live ISO をカスタマイズ（Cubic/live-build）。
2. ブートメニューで「一般 / MDM」を選択。
3. MDM モード: Live 上で AP を起動し、`/provision` へ QR/フォームで Wi‑Fi/MDM 情報を送信 → autoinstall を生成して半自動インストール。
4. インストール完了後に `install.sh` が自動実行。

PoC スクリプト: `live/provision-ap.sh`

## MDM サーバ（PoC）

`mdm_server/server.py` を参照。Flask で enroll/checkin/policies/自己更新を提供します。

- API ドキュメント: `mdm_server/API.md`
- GUI クライアント（PoC）: `mdm_server/clients/teacher_client.py`, `mdm_server/clients/server_admin_client.py`


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