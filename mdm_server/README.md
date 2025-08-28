# SIS MDM Server (PoC)

軽量な自己完結API（Flask）で enroll/checkin/policies/クライアント自己更新バンドルURL を提供するサンプルです。
本番では認証/署名/監査/DBを強化してください。

## 起動

1) 仮想環境と依存のセットアップ

python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

2) サーバ起動

python server.py

環境変数
- SIS_JWT_SECRET: トークン署名の秘密
- SIS_DB: DB用ディレクトリ（デフォルト ./_db）

APIドキュメント: API.md

## GUI クライアント（PoC）

事前に: pip install PyQt5 requests

- 教師用: clients/teacher_client.py
	- ログイン（ユーザー/パス/OTP）
	- 権限に応じて Broadcast / Lock Screen が使用可能

- サーバ管理用: clients/server_admin_client.py
	- 役割（ロール）の JSON を取得・編集
	- 任意ユーザーにロールを割当
