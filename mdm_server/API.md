# MDM Server API (PoC)

Base URL: http://<server>:5000

## Auth
- POST /auth/bootstrap
  - Body: { "user","pass" }
  - 初期管理者を作成し、OTPシークレットを返す: { ok, otp_secret }
- POST /auth/login
  - Body: { "user","pass","otp" }
  - { ok, token, perms }
- GET /auth/me (Bearer token)
  - { user, perms }

## RBAC
- GET /roles (perm: policy.edit)
- POST /roles { role: [perm,...] } (perm: policy.edit)
- POST /users/assign { user, roles:[...] } (perm: policy.edit)

## Devices
- POST /devices/enroll { serial, secret } -> { ok, device_id }
- POST /devices/checkin { device_id, inventory } -> { ok }
- GET  /devices/policies?deviceId=... (auth) -> { wifi, restrictions, ... }
- GET  /client/bundle-url (auth) -> { url }

## Classroom/Control (auth)
- POST /devices/broadcast { message }  (perm: class.broadcast)
- POST /devices/command { target?, action, args? } (perm: device.control)

Errors: 401 unauthorized, 403 forbidden, 400 bad request.