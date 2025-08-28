#!/usr/bin/env bash
set -euo pipefail
# Simple screen recorder using gnome-screencast or ffmpeg fallback
OUT=${1:-$HOME/Videos/sis-record-$(date +%F_%H-%M-%S).mkv}
if command -v gnome-sound-recorder >/dev/null 2>&1; then exec gnome-sound-recorder; fi
if command -v gnome-screenshot >/dev/null 2>&1; then echo "Use GNOME built-in shortcuts for recording"; exit 0; fi
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -video_size $(xdpyinfo | awk '/dimensions/{print $2}') -f x11grab -i $DISPLAY -f pulse -i default -c:v libx264 -preset veryfast -c:a aac "$OUT"
else
  echo "No recorder available"; exit 1
fi
