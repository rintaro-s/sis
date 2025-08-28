#!/usr/bin/env bash
set -euo pipefail
# Configure GNOME custom keybindings for SIS UI (per-user)
# Usage: install-keybindings.sh [--once]

ONCE=0
if [[ "${1:-}" == "--once" ]]; then ONCE=1; fi

user_from_env() {
  if [[ -n "${SUDO_USER:-}" ]]; then echo "$SUDO_USER"; else echo "$(id -un)"; fi
}

USER_NAME="$(user_from_env)"
USER_HOME=$(eval echo "~$USER_NAME")
if ! command -v gsettings >/dev/null 2>&1; then
  echo "[keybind] gsettings not found; skipping." >&2
  exit 0
fi

MARKER="$USER_HOME/.config/.sis-keybindings.done"
if [[ $ONCE -eq 1 && -f "$MARKER" ]]; then
  exit 0
fi

apply_for_user() {
  local user="$1"
  local cmd_prefix=(sudo -u "$user" dbus-launch gsettings)
  # Existing list
  local base="org.gnome.settings-daemon.plugins.media-keys"
  local list="$(${cmd_prefix[@]} get "$base" custom-keybindings | tr -d "'")"
  [[ -z "$list" || "$list" == "@as []" ]] && list="[]"

  # Define entries
  declare -A name cmd key
  name[0]="SIS: Focus/Launch"
  cmd[0]="/bin/bash -lc 'wmctrl -x -a "SIS\ Desktop" || /usr/bin/sis-ui'"
  key[0]="<Super>s"

  name[1]="SIS: Command Palette"
  cmd[1]="/usr/bin/sis-ui --toggle-palette"
  key[1]="<Control>p"

  name[2]="SIS: Control Center"
  cmd[2]="/usr/bin/sis-ui --toggle-cc"
  key[2]="<Control><Shift>c"

  name[3]="SIS: Terminal"
  cmd[3]="/usr/bin/sis-ui --toggle-terminal"
  key[3]="<Control><Shift>7"

  # Build new keys paths
  local paths=()
  for i in 0 1 2 3; do paths+=("/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom${i}/"); done
  local arr="["; for p in "${paths[@]}"; do arr+="'$p', "; done; arr="${arr%, }]"
  ${cmd_prefix[@]} set "$base" custom-keybindings "$arr" || true

  # Write each binding
  for i in 0 1 2 3; do
    local path="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom${i}/"
    ${cmd_prefix[@]} set "$base.custom-keybinding:$path" name "${name[$i]}" || true
    ${cmd_prefix[@]} set "$base.custom-keybinding:$path" command "${cmd[$i]}" || true
    ${cmd_prefix[@]} set "$base.custom-keybinding:$path" binding "${key[$i]}" || true
  done
}

apply_for_user "$USER_NAME" || true
if [[ $ONCE -eq 1 ]]; then
  mkdir -p "$USER_HOME/.config" && touch "$MARKER" && chown "$USER_NAME":"$USER_NAME" "$MARKER" || true
fi

echo "[keybind] Applied for user: $USER_NAME"
