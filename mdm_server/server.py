#!/usr/bin/env python3
from flask import Flask, request, jsonify
import time, os, json, hashlib, hmac, base64
import pyotp, jwt

app = Flask(__name__)
app.config['JWT_SECRET'] = os.environ.get('SIS_JWT_SECRET', 'dev-secret')

db_dir = os.environ.get('SIS_DB', './_db')
os.makedirs(db_dir, exist_ok=True)

# --- In-memory/simple db files ---
users_file = os.path.join(db_dir, 'users.json')
roles_file = os.path.join(db_dir, 'roles.json')
perms_file = os.path.join(db_dir, 'permissions.json')

def load_json(path, default):
    if os.path.exists(path):
        with open(path,'r') as f: return json.load(f)
    return default

def save_json(path, data):
    with open(path,'w') as f: json.dump(data, f, indent=2)

def init_bootstrap():
    users = load_json(users_file, {})
    roles = load_json(roles_file, {})
    perms = load_json(perms_file, {})
    if not users:
        # First-run bootstrap: admin user + OTP secret
        admin_user = os.environ.get('SIS_BOOT_USER','admin')
        admin_pass = os.environ.get('SIS_BOOT_PASS','admin1234')
        otp_secret = pyotp.random_base32()
        users[admin_user] = {"pass":hashlib.sha256(admin_pass.encode()).hexdigest(), "otp":otp_secret, "roles":["server-admin"]}
        save_json(users_file, users)
        # default roles & permissions (fine-grained)
        perms = {
          "device.view": True,
          "device.control": True,
          "policy.edit": True,
          "class.broadcast": True,
          "exam.mode": True,
          "student.screen.lock": True,
          "student.app.block": True,
          "printer.manage": True,
          "network.manage": True,
          "certificate.manage": True
        }
        roles = {
          "server-admin": list(perms.keys()),
          "teacher": ["device.view","class.broadcast","student.screen.lock","student.app.block"],
          "it-support": ["device.view","device.control","printer.manage","network.manage"],
        }
        save_json(perms_file, perms); save_json(roles_file, roles)
init_bootstrap()

def verify_password(stored_hash, password):
    return stored_hash == hashlib.sha256(password.encode()).hexdigest()

def role_perms(username):
    users = load_json(users_file, {}); roles = load_json(roles_file, {});
    u = users.get(username); acc = set()
    if not u: return []
    for r in u.get('roles', []):
        for p in roles.get(r, []): acc.add(p)
    return sorted(list(acc))

def issue_token(username):
    perms = role_perms(username)
    payload = {"sub": username, "perms": perms, "iat": int(time.time()), "exp": int(time.time())+3600}
    return jwt.encode(payload, app.config['JWT_SECRET'], algorithm='HS256')

def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        hdr = request.headers.get('Authorization','')
        if not hdr.startswith('Bearer '): return jsonify({"error":"auth"}), 401
        token = hdr.split(' ',1)[1]
        try:
            request.user = jwt.decode(token, app.config['JWT_SECRET'], algorithms=['HS256'])
        except Exception:
            return jsonify({"error":"token"}), 401
        return f(*args, **kwargs)
    return wrapper

@app.post('/devices/enroll')
def enroll():
    data = request.get_json(force=True)
    did = f"dev-{int(time.time())}"
    data['device_id'] = did
    with open(os.path.join(db_dir, f"{did}.json"), 'w') as f:
        json.dump(data, f)
    return jsonify({"ok": True, "device_id": did})

@app.post('/devices/checkin')
def checkin():
    # store last checkin
    with open(os.path.join(db_dir, 'last_checkin.txt'), 'w') as f:
        f.write(time.strftime('%Y-%m-%dT%H:%M:%S'))
    return jsonify({"ok": True})

@app.get('/devices/policies')
@require_auth
def policies():
    # return static PoC policies
    return jsonify({"wifi": {}, "restrictions": {"screenrecord": True}})

@app.get('/client/bundle-url')
@require_auth
def bundle_url():
    # return URL to a shell script that updates agent
    return jsonify({"url": "/static/agent-update.sh"})

@app.get('/static/agent-update.sh')
def agent_bundle():
    sh = """#!/usr/bin/env bash
set -euo pipefail
# Example: update mdm-agent from server
curl -fsSL ${SIS_MDM_URL:-http://localhost:5000}/static/mdm-agent.sh -o /usr/local/sis/mdm-agent.sh
chmod +x /usr/local/sis/mdm-agent.sh
"""
    return (sh, 200, {'Content-Type': 'text/x-shellscript'})

@app.get('/static/mdm-agent.sh')
def agent_script():
    # In real world, serve a versioned/certified agent bundle.
    return ("echo updated", 200, {'Content-Type': 'text/x-shellscript'})

@app.post('/auth/bootstrap')
def auth_bootstrap():
    # set/change admin user pass and get OTP secret on first run
    data = request.get_json(force=True)
    user = data.get('user'); pw = data.get('pass')
    if not user or not pw: return jsonify({"error":"bad"}), 400
    users = load_json(users_file, {})
    if users:
        return jsonify({"error":"already-initialized"}), 409
    otp_secret = pyotp.random_base32()
    users[user] = {"pass":hashlib.sha256(pw.encode()).hexdigest(), "otp":otp_secret, "roles":["server-admin"]}
    save_json(users_file, users)
    return jsonify({"ok":True, "otp_secret": otp_secret})

@app.post('/auth/login')
def auth_login():
    data = request.get_json(force=True)
    user = data.get('user'); pw = data.get('pass'); otp = data.get('otp')
    users = load_json(users_file, {})
    u = users.get(user)
    if not u or not verify_password(u['pass'], pw):
        return jsonify({"error":"invalid"}), 401
    if not pyotp.TOTP(u['otp']).verify(str(otp)):
        return jsonify({"error":"otp"}), 401
    token = issue_token(user)
    return jsonify({"ok": True, "token": token, "perms": role_perms(user)})

@app.get('/auth/me')
@require_auth
def auth_me():
    return jsonify({"user": request.user['sub'], "perms": request.user['perms']})

@app.get('/roles')
@require_auth
def get_roles():
    if 'policy.edit' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    return jsonify(load_json(roles_file, {}))

@app.post('/roles')
@require_auth
def set_roles():
    # expects {role: [perm,...]}
    if 'policy.edit' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    roles = request.get_json(force=True)
    save_json(roles_file, roles)
    return jsonify({"ok": True})

@app.post('/users/assign')
@require_auth
def user_assign():
    # {user:"teacher1", roles:["teacher"]}
    if 'policy.edit' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    data = request.get_json(force=True)
    users = load_json(users_file, {})
    u = users.get(data['user'], {"pass":"","otp": pyotp.random_base32(), "roles": []})
    u['roles'] = data.get('roles', [])
    users[data['user']] = u
    save_json(users_file, users)
    return jsonify({"ok": True})

@app.post('/devices/broadcast')
@require_auth
def devices_broadcast():
    # requires permission class.broadcast
    if 'class.broadcast' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    data = request.get_json(force=True)
    msg = data.get('message','')
    # PoC: store to file
    with open(os.path.join(db_dir, 'broadcast.log'), 'a') as f:
        f.write(time.strftime('%F %T')+" "+request.user['sub']+": "+msg+"\n")
    return jsonify({"ok": True})

@app.post('/devices/command')
@require_auth
def devices_command():
    # requires device.control
    if 'device.control' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    data = request.get_json(force=True)
    # PoC: store commands
    with open(os.path.join(db_dir, 'commands.log'), 'a') as f:
        f.write(json.dumps({"user":request.user['sub'], "cmd":data, "ts":time.time()})+"\n")
    return jsonify({"ok": True})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
