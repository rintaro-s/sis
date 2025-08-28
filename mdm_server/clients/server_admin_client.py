#!/usr/bin/env python3
import sys, os, json, requests
from PyQt5 import QtWidgets

API = os.environ.get('SIS_MDM_URL', 'http://localhost:5000')

def login_dialog():
    d = QtWidgets.QDialog(); d.setWindowTitle('Server Admin Login')
    f = QtWidgets.QFormLayout(d)
    u = QtWidgets.QLineEdit(); p = QtWidgets.QLineEdit(); p.setEchoMode(QtWidgets.QLineEdit.Password); o = QtWidgets.QLineEdit()
    f.addRow('User', u); f.addRow('Pass', p); f.addRow('OTP', o)
    b = QtWidgets.QPushButton('Login'); f.addRow(b); b.clicked.connect(d.accept)
    if d.exec_() != QtWidgets.QDialog.Accepted:
        return None
    return {'user': u.text(), 'pass': p.text(), 'otp': o.text()}

class Admin(QtWidgets.QWidget):
    def __init__(self, token):
        super().__init__()
        self.token = token; self.setWindowTitle('MDM Server Admin')
        v = QtWidgets.QVBoxLayout(self)
        self.roles = QtWidgets.QPlainTextEdit(); v.addWidget(self.roles)
        hb = QtWidgets.QHBoxLayout(); v.addLayout(hb)
        self.user = QtWidgets.QLineEdit(); self.user.setPlaceholderText('username')
        self.assign = QtWidgets.QLineEdit(); self.assign.setPlaceholderText('roles comma separated')
        hb.addWidget(self.user); hb.addWidget(self.assign)
        b_save = QtWidgets.QPushButton('Save Roles JSON'); b_save.clicked.connect(self.save_roles)
        b_assign = QtWidgets.QPushButton('Assign Roles'); b_assign.clicked.connect(self.assign_roles)
        v.addWidget(b_save); v.addWidget(b_assign)
        self.refresh()

    def headers(self):
        return {'Authorization': f'Bearer {self.token}'}

    def refresh(self):
        r = requests.get(f"{API}/roles", headers=self.headers())
        self.roles.setPlainText(json.dumps(r.json(), indent=2))

    def save_roles(self):
        data = json.loads(self.roles.toPlainText() or '{}')
        r = requests.post(f"{API}/roles", headers=self.headers(), json=data)
        if r.status_code == 200:
            self.refresh()

    def assign_roles(self):
        user = self.user.text().strip(); roles = [s.strip() for s in self.assign.text().split(',') if s.strip()]
        requests.post(f"{API}/users/assign", headers=self.headers(), json={'user':user, 'roles': roles})

def main():
    app = QtWidgets.QApplication(sys.argv)
    creds = login_dialog()
    if creds is None:
        return 0
    r = requests.post(f"{API}/auth/login", json=creds)
    if r.status_code != 200:
        QtWidgets.QMessageBox.critical(None,'Login','Failed'); return 1
    w = Admin(r.json()['token']); w.resize(600,400); w.show()
    return app.exec_()

if __name__ == '__main__':
    sys.exit(main())
