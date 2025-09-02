#!/usr/bin/env python3
"""
SIS Manager CLI Tool
学校向けセットアップ・管理ツール
"""

import argparse
import subprocess
import sys
import os

class SISManager:
    def __init__(self):
        self.root_dir = os.path.dirname(os.path.abspath(__file__))

    def run_command(self, cmd, cwd=None, shell=False):
        """コマンドを実行"""
        try:
            result = subprocess.run(cmd, cwd=cwd or self.root_dir, shell=shell, check=True, capture_output=True, text=True)
            print(result.stdout)
            return True
        except subprocess.CalledProcessError as e:
            print(f"Error: {e}")
            print(e.stderr)
            return False

    def install_full(self, args):
        """フルインストール"""
        print("フルインストールを開始します...")
        script = os.path.join(self.root_dir, 'install.sh')
        if not os.path.exists(script):
            print("install.sh が見つかりません")
            return
        cmd = ['sudo', 'bash', script]
        if args.dry_run:
            cmd.append('--dry-run')
        if args.no_ui:
            cmd.append('--no-ui')
        if args.with_veyon:
            cmd.append('--with-veyon')
        if args.with_syncthing:
            cmd.append('--with-syncthing')
        self.run_command(cmd)

    def deploy_ui(self, args):
        """デスクトップ環境配備"""
        print("デスクトップ環境を配備します...")
        script = os.path.join(self.root_dir, 'DE-deploy.sh')
        if not os.path.exists(script):
            print("DE-deploy.sh が見つかりません")
            return
        self.run_command(['sudo', 'bash', script])

    def try_deploy(self, args):
        """試用モード"""
        print("試用モードで配備します...")
        script = os.path.join(self.root_dir, 'try-deploy.sh')
        if not os.path.exists(script):
            print("try-deploy.sh が見つかりません")
            return
        self.run_command(['bash', script])

    def mdm_server(self, args):
        """MDMサーバー起動"""
        print("MDMサーバーを起動します...")
        mdm_dir = os.path.join(self.root_dir, 'mdm_server')
        if not os.path.exists(mdm_dir):
            print("mdm_server ディレクトリが見つかりません")
            return
        # 仮想環境チェック
        venv_dir = os.path.join(mdm_dir, '.venv')
        if not os.path.exists(venv_dir):
            print("仮想環境を作成します...")
            self.run_command(['python3', '-m', 'venv', '.venv'], cwd=mdm_dir)
        # 依存インストール
        activate = os.path.join(venv_dir, 'bin', 'activate')
        req_file = os.path.join(mdm_dir, 'requirements.txt')
        if os.path.exists(req_file):
            self.run_command([f'source {activate} && pip install -r requirements.txt'], cwd=mdm_dir, shell=True)
        # サーバー起動
        self.run_command([f'source {activate} && python server.py'], cwd=mdm_dir, shell=True)

    def mdm_client(self, args):
        """MDMクライアント（教師用）"""
        print("MDMクライアントを起動します...")
        client_dir = os.path.join(self.root_dir, 'mdm_server', 'clients')
        if not os.path.exists(client_dir):
            print("clients ディレクトリが見つかりません")
            return
        # PyQt5 チェック
        try:
            import PyQt5
        except ImportError:
            print("PyQt5 をインストールします...")
            self.run_command(['pip', 'install', 'PyQt5', 'requests'])
        # クライアント起動
        if args.admin:
            script = 'server_admin_client.py'
        else:
            script = 'teacher_client.py'
        self.run_command(['python3', script], cwd=client_dir)

    def build_ui(self, args):
        """UIビルド"""
        print("SIS UI をビルドします...")
        ui_dir = os.path.join(self.root_dir, 'sis-ui')
        if not os.path.exists(ui_dir):
            print("sis-ui ディレクトリが見つかりません")
            return
        self.run_command(['npm', 'ci'], cwd=ui_dir)
        self.run_command(['npm', 'run', 'build'], cwd=ui_dir)

    def package_install(self, args):
        """パッケージインストール"""
        print("依存パッケージをインストールします...")
        script = os.path.join(self.root_dir, 'package_install.sh')
        if not os.path.exists(script):
            print("package_install.sh が見つかりません")
            return
        self.run_command(['sudo', 'bash', script])

def main():
    parser = argparse.ArgumentParser(description='SIS Manager CLI')
    subparsers = parser.add_subparsers(dest='command', help='サブコマンド')

    # install
    install_parser = subparsers.add_parser('install', help='フルインストール')
    install_parser.add_argument('--dry-run', action='store_true', help='ドライラン')
    install_parser.add_argument('--no-ui', action='store_true', help='UIスキップ')
    install_parser.add_argument('--with-veyon', action='store_true', help='Veyon導入')
    install_parser.add_argument('--with-syncthing', action='store_true', help='Syncthing導入')

    # deploy
    subparsers.add_parser('deploy', help='デスクトップ環境配備')

    # try
    subparsers.add_parser('try', help='試用モード')

    # mdm-server
    subparsers.add_parser('mdm-server', help='MDMサーバー起動')

    # mdm-client
    client_parser = subparsers.add_parser('mdm-client', help='MDMクライアント起動')
    client_parser.add_argument('--admin', action='store_true', help='管理者モード')

    # build-ui
    subparsers.add_parser('build-ui', help='UIビルド')

    # package-install
    subparsers.add_parser('package-install', help='パッケージインストール')

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return

    manager = SISManager()

    if args.command == 'install':
        manager.install_full(args)
    elif args.command == 'deploy':
        manager.deploy_ui(args)
    elif args.command == 'try':
        manager.try_deploy(args)
    elif args.command == 'mdm-server':
        manager.mdm_server(args)
    elif args.command == 'mdm-client':
        manager.mdm_client(args)
    elif args.command == 'build-ui':
        manager.build_ui(args)
    elif args.command == 'package-install':
        manager.package_install(args)

if __name__ == '__main__':
    main()
