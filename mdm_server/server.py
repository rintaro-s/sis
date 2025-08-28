#!/usr/bin/env python3
from flask import Flask, request, jsonify, send_file
import time, os, json, hashlib, hmac, base64, secrets
import pyotp, jwt

app = Flask(__name__)
app.config['JWT_SECRET'] = os.environ.get('SIS_JWT_SECRET', 'dev-secret')

db_dir = os.environ.get('SIS_DB', './_db')
os.makedirs(db_dir, exist_ok=True)
queues_dir = os.path.join(db_dir, 'queues'); os.makedirs(queues_dir, exist_ok=True)
shots_dir = os.path.join(db_dir, 'screenshots'); os.makedirs(shots_dir, exist_ok=True)
files_dir = os.path.join(db_dir, 'files'); os.makedirs(files_dir, exist_ok=True)
files_store = os.path.join(files_dir, 'store'); os.makedirs(files_store, exist_ok=True)
files_pending = os.path.join(files_dir, 'pending'); os.makedirs(files_pending, exist_ok=True)
files_collected = os.path.join(files_dir, 'collected'); os.makedirs(files_collected, exist_ok=True)
telemetry_dir = os.path.join(db_dir, 'telemetry'); os.makedirs(telemetry_dir, exist_ok=True)

# --- In-memory/simple db files ---
users_file = os.path.join(db_dir, 'users.json')
roles_file = os.path.join(db_dir, 'roles.json')
perms_file = os.path.join(db_dir, 'permissions.json')
policies_file = os.path.join(db_dir, 'policies.json')

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

def get_device_record_path(device_id: str):
    return os.path.join(db_dir, f"{device_id}.json")

def get_device_secret(device_id: str):
    path = get_device_record_path(device_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path,'r') as f:
            rec = json.load(f)
        return rec.get('token')
    except Exception:
        return None

def require_device(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        did = request.headers.get('X-Device-ID','')
        tok = request.headers.get('X-Device-Token','')
        if not did or not tok:
            return jsonify({"error":"device-auth"}), 401
        secret = get_device_secret(did)
        if not secret or secret != tok:
            return jsonify({"error":"device-auth"}), 401
        request.device_id = did
        return f(*args, **kwargs)
    return wrapper

def try_user_or_device():
    # returns (mode, identity|None)
    hdr = request.headers.get('Authorization','')
    if hdr.startswith('Bearer '):
        token = hdr.split(' ',1)[1]
        try:
            u = jwt.decode(token, app.config['JWT_SECRET'], algorithms=['HS256'])
            request.user = u
            return ('user', u)
        except Exception:
            pass
    did = request.headers.get('X-Device-ID','')
    tok = request.headers.get('X-Device-Token','')
    if did and tok and get_device_secret(did) == tok:
        request.device_id = did
        return ('device', did)
    return (None, None)

def queue_path(device_id):
    return os.path.join(queues_dir, f"{device_id}.json")

def queue_enqueue(device_id, cmd):
    qf = queue_path(device_id)
    q = load_json(qf, [])
    q.append(cmd)
    save_json(qf, q)

def queue_pop_all(device_id):
    qf = queue_path(device_id)
    q = load_json(qf, [])
    save_json(qf, [])
    return q

def policies_get(device_id: str):
    pol = load_json(policies_file, {"default":{}, "devices":{}})
    res = {}
    res.update(pol.get('default', {}))
    res.update(pol.get('devices', {}).get(device_id, {}))
    return res

def policies_set(scope: str, id_: str, value: dict):
    pol = load_json(policies_file, {"default":{}, "devices":{}})
    if scope == 'default':
        pol['default'] = value
    elif scope == 'device':
        pol.setdefault('devices', {})[id_] = value
    else:
        raise ValueError('unsupported scope')
    save_json(policies_file, pol)

@app.post('/devices/enroll')
def enroll():
    data = request.get_json(force=True)
    did = f"dev-{int(time.time())}"
    token = secrets.token_hex(16)
    rec = {"device_id": did, "token": token, "info": data, "created": int(time.time())}
    with open(get_device_record_path(did), 'w') as f:
        json.dump(rec, f)
    return jsonify({"ok": True, "device_id": did, "device_token": token})

@app.post('/devices/checkin')
@require_device
def checkin():
    # store last checkin
    with open(os.path.join(db_dir, 'last_checkin.txt'), 'w') as f:
    f.write(time.strftime('%Y-%m-%dT%H:%M:%S')+f" {request.device_id}")
    return jsonify({"ok": True})

@app.get('/devices/policies')
def policies():
    mode, ident = try_user_or_device()
    if not mode:
        return jsonify({"error":"auth"}), 401
    device_id = request.args.get('deviceId') or (request.device_id if mode=='device' else '')
    return jsonify(policies_get(device_id or ''))

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

# --- Telemetry (opt-in by policy) ---
@app.post('/telemetry/upload')
@require_device
def telemetry_upload():
    did = request.device_id
    data = request.get_json(force=True)
    path = os.path.join(telemetry_dir, f"{did}.log")
    with open(path, 'a') as f:
        f.write(json.dumps({"ts": int(time.time()), **data})+"\n")
    return jsonify({"ok": True})

@app.get('/telemetry/<device_id>')
@require_auth
def telemetry_view(device_id):
    if 'device.view' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    path = os.path.join(telemetry_dir, f"{device_id}.log")
    if not os.path.exists(path):
        return jsonify({"items": []})
    items = []
    try:
        with open(path,'r') as f:
            for line in f:
                items.append(json.loads(line))
    except Exception:
        items = []
    # limit last 200
    items = items[-200:]
    return jsonify({"items": items})

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

# --- Command queue API ---
@app.post('/devices/commands/enqueue')
@require_auth
def commands_enqueue():
    data = request.get_json(force=True)
    # {deviceId?, action, args?, broadcast?}
    if 'device.control' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    if data.get('broadcast'):
        # naive: enqueue to all known devices (by files in db)
        for name in os.listdir(db_dir):
            if name.endswith('.json') and name.startswith('dev-'):
                did = name[:-5]
                queue_enqueue(did, data)
    else:
        did = data.get('deviceId')
        if not did:
            return jsonify({"error":"deviceId required"}), 400
        queue_enqueue(did, data)
    return jsonify({"ok": True})

@app.post('/devices/commands/poll')
@require_device
def commands_poll():
    did = request.device_id
    cmds = queue_pop_all(did)
    return jsonify({"commands": cmds})

# --- Screenshot upload & listing ---
@app.post('/devices/screenshot')
@require_device
def upload_screenshot():
    did = request.device_id
    f = request.files.get('file')
    if not f: return jsonify({"error":"file missing"}), 400
    ts = int(time.time())
    path = os.path.join(shots_dir, f"{did}_{ts}.png")
    f.save(path)
    return jsonify({"ok": True, "path": path})

@app.get('/devices/<device_id>/screenshots')
@require_auth
def list_screenshots(device_id):
    if 'device.view' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    files = [x for x in os.listdir(shots_dir) if x.startswith(f"{device_id}_")]
    files.sort(reverse=True)
    return jsonify({"files": files})

@app.get('/devices/screenshots/download/<name>')
@require_auth
def download_screenshot(name):
    if 'device.view' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    path = os.path.join(shots_dir, name)
    if not os.path.isfile(path):
        return jsonify({"error":"not found"}), 404
    return send_file(path, mimetype='image/png', as_attachment=False)

# --- Files push/collect ---
@app.post('/files/push')
@require_auth
def files_push():
    if 'device.control' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    target = request.form.get('deviceId') or 'all'
    up = request.files.get('file')
    if not up: return jsonify({"error":"file"}), 400
    fid = f"f{int(time.time()*1000)}"
    folder = os.path.join(files_store, fid)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, up.filename)
    up.save(path)
    meta = {"id": fid, "name": up.filename, "path": path, "ts": time.time()}
    save_json(os.path.join(folder, 'meta.json'), meta)
    # enqueue pending
    def pend_for(did):
        pf = os.path.join(files_pending, f"{did}.json")
        arr = load_json(pf, [])
        arr.append({"id": fid, "name": up.filename})
        save_json(pf, arr)
    if target == 'all':
        # naive: broadcast to all devices known by queues
        for name in os.listdir(queues_dir):
            if name.endswith('.json'):
                pend_for(name[:-5])
    else:
        pend_for(target)
    return jsonify({"ok": True, "id": fid, "download": f"/files/download/{fid}"})

@app.get('/files/pending')
@require_device
def files_pending_list():
    did = request.device_id
    pf = os.path.join(files_pending, f"{did}.json")
    arr = load_json(pf, [])
    save_json(pf, [])
    return jsonify({"files": arr})

@app.get('/files/download/<fid>')
def files_download(fid):
    folder = os.path.join(files_store, fid)
    meta = load_json(os.path.join(folder, 'meta.json'), None)
    if not meta: return jsonify({"error":"not found"}), 404
    return send_file(meta['path'], as_attachment=True)

@app.post('/files/collect')
@require_device
def files_collect():
    did = request.device_id
    up = request.files.get('file')
    if not up: return jsonify({"error":"file"}), 400
    folder = os.path.join(files_collected, did)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{int(time.time())}_{up.filename}")
    up.save(path)
    return jsonify({"ok": True})

# --- Policies set/view ---
@app.post('/policies/set')
@require_auth
def policies_set_api():
    if 'policy.edit' not in request.user.get('perms', []):
        return jsonify({"error":"forbidden"}), 403
    data = request.get_json(force=True)
    scope = data.get('scope','default'); id_ = data.get('id',''); value = data.get('policies',{})
    policies_set(scope, id_, value)
    return jsonify({"ok": True})

@app.get('/policies/view')
def policies_view_api():
    did = request.args.get('deviceId') or ''
    pol = policies_get(did)
    # return only transparency-focused subset for student display
    vis = {
        "monitoring": pol.get('monitoring', {
            "screen": False, "web_history": False, "images": False, "files": False
        }),
        "screen_time": pol.get('screen_time', {})
    }
    return jsonify(vis)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
