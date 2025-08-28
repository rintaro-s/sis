# SIS Unified Setup（学校端末OS / 管理スイート）

このリポジトリは Ubuntu 24+ をベースにした学校向け端末の魔改造セットアップを提供します。

主コマンド: `install.sh`

- 監査/ログ収集、更新管理（授業時間帯回避）、DNSフィルタ、MDMフック、ゼロタッチ初期化、授業系下地（Veyon/試験モード）を一括導入します。
- デスクトップは `DE-deploy.sh` で sis-ui を配備します。

## 使い方（セットアップ）

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

### MDMの主な機能（現状）
- 端末登録（enroll）/ 定期チェックイン（inventory送付）
- ポリシー配布（Wi‑Fi/Proxy/証明書/プリンタ/アプリ制限/スクリーンタイム）
- コマンド配信（画面ロック/通知/任意コマンド）
- 画面の静止画取得（生徒に通知設計可）
- ファイル配布・回収（授業課題の配布/提出）
- Broadcast（クラス全員へメッセージ）

### 教師/生徒の権限と可視化
- ロール/権限
	- server-admin: 全権
	- teacher: device.view, class.broadcast, student.screen.lock, student.app.block
	- it-support: device.view, device.control, printer.manage, network.manage
- 可視化（生徒端末に表示できる情報）
	- 何が監視/制御対象か（画面・Web履歴・画像・ファイル）を `/policies/view` の応答に含め公開
	- アクティブなスクリーンタイム/試験モード/フィルタ状態をトレイや設定画面で提示（UI連携は今後拡張）

### 現場導入の例
- 授業前: 教師が Broadcast で指示、配布ファイルを push、スクリーンタイムを授業時間に合わせて自動適用
- 授業中: 必要に応じて画面ロック/解除、任意コマンドでアプリ起動制御、提出物は students 側から submit-file
- 授業後: 回収ファイルを確認、ログを確認、次回のポリシーを編集

### 重要なポリシー項目（提案）
- monitoring.screen: 画面の静止画取得可否（ON時は撮影時に生徒へ通知）
- monitoring.web_history: 検索/閲覧履歴の収集可否（デフォルトOFF、ONなら生徒へ常時表示）
- monitoring.images: 画像ファイルの内容検査可否（デフォルトOFF、違反検知時のみ匿名統計）
- monitoring.files: ユーザーディレクトリの閲覧可否（デフォルトOFF、授業フォルダのみ推奨）
- screen_time: 平日/休日・時間帯・最大使用時間の制限
- app.blocks: プロセス名/パッケージ名のブロック

注意: 学校の規程と保護者の合意に沿って、監視項目は最小限に。生徒側に常に「何が見られているか」を明示します。

### エージェント（mdm-agent.sh）便利コマンド
- enroll: 初回登録
- apply: ポリシー適用
- poll: サーバからのコマンドを取得して実行
- screenshot: 一枚スクショをサーバへアップロード
- pull-files: サーバから配布されたファイルを受け取る
- submit-file <path>: 提出物をサーバへアップロード

systemd タイマーで checkin/apply/poll を定期実行する設計に拡張可能です。


# SIS UI

- 「使う人」の為のデスクトップ環境です。  
- React + Tauri で作ってます。  
- ローカルのLLMサーバー（例: LMstudio, Ollama, llama.cppサーバー）と連携して、チャットやコマンド生成ができます。  
- まだ全部はできてないけど、だいたい動くところは動きます。


https://github.com/user-attachments/assets/bbae3072-a3e8-4e8c-b9b8-a91d429318ed


体験的なUI（このブランチの変更点）:
- Alt+Space 長押しで「Halo HUD + 円形メニュー」、短押しでコマンドパレット
- 3つのホットコーナー（左上=パレット、右上=内蔵ターミナル、右下=コントロールセンター）
- ミドルクリックでも円形メニューを即起動

## できること（現状）

- コマンドパレット（Ctrl+P）でAIに「○○して」って言うとコマンドを生成してくれる
- GNOMEやXfceのセッションとして自動起動できる（DE-deploy.sh で全部やってくれる）
- ショートカット（SuperキーやCtrl+Pなど）でどこからでもPaletteやTerminalを開ける（WaylandはGNOMEカスタムショートカット推奨）

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

## ISOの作り方（体験用のカスタムLive ISO）

Ubuntu 24.04 Desktop ISOをベースに、本リポジトリの`install.sh`と`sis-ui`を同梱した体験用ISOを生成できます。まずは最小構成で「触って分かる」を優先しています。

前提:
- Ubuntu 24.04系ホスト推奨
- 約8GB以上の空き容量
- 必要ツール: squashfs-tools, xorriso, isolinux/syslinux, rsync, p7zip-full

手順（最短）:
1) Ubuntu Desktop 24.04 ISO を取得（例: ubuntu-24.04.1-desktop-amd64.iso）
2) 下記スクリプトを実行

```bash
bash tools/make-iso.sh /path/to/ubuntu-24.04.1-desktop-amd64.iso
```

完了すると `dist/sis-os-ubuntu24-custom.iso` が生成されます。

Live起動後の体験ポイント:
- Dock/Sidebar/ホットコーナー（画面左上/右上/右下）
- Alt+Space 短押し: コマンドパレット、長押し: Halo HUD + 円形メニュー
- Ctrl+Shift+C: ミニ・コントロールセンター、Ctrl+Shift+7: 内蔵ターミナル

インストール（任意）:
- デスクトップの「SIS Install」を実行すると `install.sh` が起動し、MDM/ログ/ネットワークフィルタ等を構成します。

注意/発展:
- セキュアブート対応やCalamares統合は別途。まずは体験優先の最小実装です。
- 本番導入ではTLS終端/署名/DB等のハードニングを行ってください。
