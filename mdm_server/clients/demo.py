#!/usr/bin/env python3
"""
Simple demo launcher for the Teacher UI (login-enabled).

Behavior:
- Attempts to perform a real login against SIS_MDM_URL (/auth/login).
- If network login fails, prompts to continue with an offline demo account.
- You can force offline mode with --offline.

Usage:
  SIS_MDM_URL='http://localhost:5000' python3 demo.py
  python3 demo.py --offline
"""
import os
import sys
import requests
from PyQt5 import QtWidgets

API = os.environ.get('SIS_MDM_URL', 'http://localhost:5000')

try:
    # reuse UI components from teacher_client
    from teacher_client import LoginDialog, Main
except Exception:
    # fallback: minimal local definitions if import fails
    class LoginDialog(QtWidgets.QDialog):
        def __init__(self):
            super().__init__()
            self.setWindowTitle('Teacher Login (demo)')
            lay = QtWidgets.QFormLayout(self)
            self.user = QtWidgets.QLineEdit(); self.passw = QtWidgets.QLineEdit(); self.passw.setEchoMode(QtWidgets.QLineEdit.Password)
            lay.addRow('User', self.user); lay.addRow('Pass', self.passw)
            btn = QtWidgets.QPushButton('Login'); btn.clicked.connect(self.accept)
            lay.addRow(btn)

        def creds(self):
            return {'user': self.user.text(), 'pass': self.passw.text(), 'otp': ''}

    class Main(QtWidgets.QWidget):
        def __init__(self, token, perms):
            super().__init__()
            self.token = token; self.perms = set(perms)
            self.setWindowTitle('Teacher Console (demo)')
            v = QtWidgets.QVBoxLayout(self)
            self.msg = QtWidgets.QLineEdit(); self.msg.setPlaceholderText('Broadcast message...')
            self.btn_b = QtWidgets.QPushButton('Broadcast'); self.btn_b.clicked.connect(self.broadcast)
            self.btn_b.setEnabled('class.broadcast' in self.perms)
            self.btn_lock = QtWidgets.QPushButton('Lock Screens'); self.btn_lock.clicked.connect(self.lock)
            self.btn_lock.setEnabled('student.screen.lock' in self.perms)
            v.addWidget(self.msg); v.addWidget(self.btn_b); v.addWidget(self.btn_lock)

        def headers(self):
            return {'Authorization': f'Bearer {self.token}'}

        def broadcast(self):
            QtWidgets.QMessageBox.information(self, 'Demo', f'Broadcast: {self.msg.text()}')

        def lock(self):
            QtWidgets.QMessageBox.information(self, 'Demo', 'Lock command sent (demo)')


def try_server_login(creds, timeout=3):
    try:
        r = requests.post(f"{API}/auth/login", json=creds, timeout=timeout)
        if r.status_code == 200:
            data = r.json()
            token = data.get('token')
            perms = data.get('perms', [])
            return token, perms
        return None, None
    except Exception:
        return None, None


def main(argv):
    offline = '--offline' in argv
    app = QtWidgets.QApplication(argv)
    dlg = LoginDialog()
    if dlg.exec_() != QtWidgets.QDialog.Accepted:
        return 0

    creds = dlg.creds()

    token = None
    perms = []

    if not offline:
        token, perms = try_server_login(creds)

    if not token:
        q = QtWidgets.QMessageBox.question(None, 'Login failed', 'Server login failed or returned error. Start offline demo session instead?', QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No)
        if q != QtWidgets.QMessageBox.Yes:
            return 1
        # offline demo token/perms
        token = 'demo-token'
        perms = ['class.broadcast', 'student.screen.lock']

    w = Main(token, perms)
    w.resize(420, 160)
    w.show()
    return app.exec_()


if __name__ == '__main__':
    sys.exit(main(sys.argv))
