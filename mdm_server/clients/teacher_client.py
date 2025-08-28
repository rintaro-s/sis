#!/usr/bin/env python3
import sys, os, json, requests
from PyQt5 import QtWidgets

API = os.environ.get('SIS_MDM_URL', 'http://localhost:5000')

class LoginDialog(QtWidgets.QDialog):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('Teacher Login')
        lay = QtWidgets.QFormLayout(self)
        self.user = QtWidgets.QLineEdit(); self.passw = QtWidgets.QLineEdit(); self.passw.setEchoMode(QtWidgets.QLineEdit.Password); self.otp = QtWidgets.QLineEdit()
        lay.addRow('User', self.user); lay.addRow('Pass', self.passw); lay.addRow('OTP', self.otp)
        btn = QtWidgets.QPushButton('Login'); btn.clicked.connect(self.accept)
        lay.addRow(btn)

    def creds(self):
        return {'user': self.user.text(), 'pass': self.passw.text(), 'otp': self.otp.text()}

class Main(QtWidgets.QWidget):
    def __init__(self, token, perms):
        super().__init__()
        self.token = token; self.perms = set(perms)
        self.setWindowTitle('Teacher Console (PoC)')
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
        requests.post(f"{API}/devices/broadcast", headers=self.headers(), json={'message': self.msg.text()})

    def lock(self):
        requests.post(f"{API}/devices/command", headers=self.headers(), json={'action':'lock_screens'})

def main():
    app = QtWidgets.QApplication(sys.argv)
    dlg = LoginDialog()
    if dlg.exec_() != QtWidgets.QDialog.Accepted:
        return 0
    r = requests.post(f"{API}/auth/login", json=dlg.creds())
    if r.status_code != 200:
        QtWidgets.QMessageBox.critical(None,'Login','Failed'); return 1
    token = r.json()['token']; perms = r.json().get('perms', [])
    w = Main(token, perms); w.resize(400,150); w.show()
    return app.exec_()

if __name__ == '__main__':
    sys.exit(main())
