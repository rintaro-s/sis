＃＃＃実行ファイルについては、
 DE-deploy.shでデスクトップ環境のインストールができます。
 動作確認ではtry-deploy.shを使用することを推奨です
 
 install.shでフルインストールができます。
 
■ MDMサーバーの起動方法
1. 仮想環境の作成と依存インストール
	python3 -m venv .venv && . .venv/bin/activate
	pip install -r mdm_server/requirements.txt
2. サーバ起動
	cd mdm_server
	python server.py

■ 端末（クライアント）のMDM登録
1. サーバー起動後、端末側で `/usr/local/sis/mdm-agent.sh enroll` を実行
2. サーバー側で登録された端末情報を確認

■ 先生用クライアント（GUI）の使い方
1. 依存インストール（初回のみ）
	pip install PyQt5 requests
2. 教師用GUIの起動
	cd mdm_server/clients
	python teacher_client.py
3. サーバーで発行したユーザー名・パスワード・OTPでログイン
   （管理者は server_admin_client.py でロール割当可能）

※詳細は mdm_server/README.md も参照

＃＃＃ソースコードは以下のディレクトリに格納されています。
デスクトップ環境：sis-ui
MDMサーバー側：mdm_server
各種シェルスクリプト：scripts、tools、live、リポジトリ直下