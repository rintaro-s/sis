#!/usr/bin/env bash
set -euo pipefail
# Best-effort: Chromium/Chrome の履歴を直近50件取り出してJSON出力
tmp=$(mktemp)
out=${1:-/dev/stdout}
browser_histories=(
  "$HOME/.config/chromium/Default/History"
  "$HOME/.config/google-chrome/Default/History"
  "$HOME/.config/google-chrome-beta/Default/History"
  "$HOME/.mozilla/firefox" # Firefoxは別形式。今回はChromium系のみ対応
)
for h in "${browser_histories[@]}"; do
  if [[ -f "$h" ]]; then src="$h"; break; fi
done
if [[ -z "${src:-}" ]]; then echo '[]' > "$out"; exit 0; fi
command -v sqlite3 >/dev/null 2>&1 || { echo '[]' > "$out"; exit 0; }
cp -f "$src" "$tmp" 2>/dev/null || true
sqlite3 -readonly -json "$tmp" 'select url, title, last_visit_time from urls order by last_visit_time desc limit 50;' > "$out" 2>/dev/null || echo '[]' > "$out"
rm -f "$tmp"
