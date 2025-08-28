#!/usr/bin/env bash
set -euo pipefail

CONF_JSON="/etc/sis/provision.json"

rand_pw(){ tr -dc A-Za-z0-9 </dev/urandom | head -c 16; echo; }

ensure_user(){
  local name="$1"; local pass="$2"; local groups="$3"; local sudoable="$4"
  if id "$name" >/dev/null 2>&1; then
    echo "[accounts] user exists: $name (skip create)"
  else
    useradd -m -s /bin/bash "$name"
  fi
  if [[ -n "$pass" ]]; then echo "$name:$pass" | chpasswd; fi
  [[ -n "$groups" ]] && usermod -aG "$groups" "$name" || true
  if [[ "$sudoable" == "yes" ]]; then usermod -aG sudo "$name" || true; fi
}

mkdir -p /etc/sis
if [[ -f "$CONF_JSON" ]]; then
  STUDENT_USER=$(jq -r '.student_username // "student"' "$CONF_JSON" 2>/dev/null || echo student)
  STUDENT_PASS=$(jq -r '.student_password // empty' "$CONF_JSON" 2>/dev/null || echo "")
  TEACHER_USER=$(jq -r '.teacher_username // "teacher"' "$CONF_JSON" 2>/dev/null || echo teacher)
  TEACHER_PASS=$(jq -r '.teacher_password // empty' "$CONF_JSON" 2>/dev/null || echo "")
  ADMIN_USER=$(jq -r '.admin_username // "mdmadmin"' "$CONF_JSON" 2>/dev/null || echo mdmadmin)
  ADMIN_PASS=$(jq -r '.admin_password // empty' "$CONF_JSON" 2>/dev/null || echo "")
else
  STUDENT_USER=student; STUDENT_PASS=""
  TEACHER_USER=teacher; TEACHER_PASS=""
  ADMIN_USER=mdmadmin; ADMIN_PASS=""
fi

[[ -z "$STUDENT_PASS" ]] && STUDENT_PASS=$(rand_pw)
[[ -z "$TEACHER_PASS" ]] && TEACHER_PASS=$(rand_pw)
[[ -z "$ADMIN_PASS" ]] && ADMIN_PASS=$(rand_pw)

groupadd -f sis-teacher || true

ensure_user "$STUDENT_USER" "$STUDENT_PASS" "" "no"
ensure_user "$TEACHER_USER" "$TEACHER_PASS" "sis-teacher" "no"
ensure_user "$ADMIN_USER"   "$ADMIN_PASS"   "" "yes"

# Persist generated credentials back to provision.json (restricted perms)
jq -n \
  --arg su "$STUDENT_USER" --arg sp "$STUDENT_PASS" \
  --arg tu "$TEACHER_USER" --arg tp "$TEACHER_PASS" \
  --arg au "$ADMIN_USER"   --arg ap "$ADMIN_PASS" \
  '{student_username:$su,student_password:$sp,teacher_username:$tu,teacher_password:$tp,admin_username:$au,admin_password:$ap}' \
  > "$CONF_JSON".tmp && mv "$CONF_JSON".tmp "$CONF_JSON"
chmod 0600 "$CONF_JSON"
chown root:root "$CONF_JSON"

echo "[accounts] Created/updated users. Admin(sudo): $ADMIN_USER. Teacher: $TEACHER_USER. Student: $STUDENT_USER"
