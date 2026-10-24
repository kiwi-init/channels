#!/usr/bin/env bash
set -u
OUT=$1
MODE=${2:-kde-focus}
HERE=$(cd "$(dirname "$0")" && pwd)
APPHOME=$(mktemp -d)
[ "$MODE" = kde-focus ] && export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
unset QT_QPA_PLATFORMTHEME
note() { echo "== $*" | tee -a "$OUT/focus.txt"; }

active() {
  if [ "$MODE" = gnome-focus ]; then
    local x
    x=$(xdotool getwindowfocus getwindowname 2> /dev/null)
    [ "$x" = Channels ] && { echo '"caption":"Channels" (X11 focus)'; return; }
    echo "\"caption\":\"$(grep -o 'ACTIVE .*' "$OUT/focus-launcher.log" | tail -n 1 | cut -c8-)\" (x11 focus: ${x:-none})"
    return
  fi
  local before
  before=$(wc -l < "$KWIN_LOG")
  python3 "$HERE/probe.py" kwin-script "$HERE/list.js" > /dev/null 2>&1
  sleep 1
  tail -n +"$((before + 1))" "$KWIN_LOG" | grep -o 'kiwi-win .*"active":true[^}]*' | grep -o '"caption":"[^"]*"' | head -n 1 || echo nothing
}

send() { echo "python3 -c \"import socket,os,sys; s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.send(('$1 '+os.environ.get('DESKTOP_STARTUP_ID','')).encode())\" $2"; }

clean() {
  pkill -f "$HERE/launcher.py" 2> /dev/null
  pkill -f "$HERE/stand-in.py" 2> /dev/null
  [ "${1:-}" = app ] && { pkill -TERM -f '/opt/Channels/bin/' 2> /dev/null; sleep 3; pkill -KILL -f '/opt/Channels/bin/' 2> /dev/null; }
  sleep 1
}

case_run() {
  local label=$1
  shift
  python3 "$HERE/launcher.py" "$@" "wait" "wait" "wait" >> "$OUT/focus-launcher.log" 2>&1 &
  sleep "${WAIT:-7}"
  note "$label -> active: $(active)"
}

[ "$MODE" = kde-focus ] && note "KWin focus stealing prevention: $(grep -A1 '\[Windows\]' "$XDG_CONFIG_HOME/kwinrc" | tail -n 1)"
note "mode $MODE"
note "A. a native GTK3 window started by the focused app"
export GDK_BACKEND=wayland
case_run "A1 no token" "none:GDK_BACKEND=wayland python3 $HERE/stand-in.py 'B none'"
clean
case_run "A2 DESKTOP_STARTUP_ID" "startup:GDK_BACKEND=wayland python3 $HERE/stand-in.py 'B startup'"
clean
case_run "A3 XDG_ACTIVATION_TOKEN only (Plasma)" "activation:GDK_BACKEND=wayland python3 $HERE/stand-in.py 'B activation'"
clean

note "B. a running native GTK3 window asked to show itself (what a second start does)"
sock="$APPHOME/resident.sock"
GDK_BACKEND=wayland python3 "$HERE/stand-in.py" "B resident" "$sock" >> "$OUT/focus-launcher.log" 2>&1 &
sleep 3
case_run "B1 visible behind, show without token" "none:$(send show "$sock")"
pkill -f "$HERE/launcher.py"
sleep 1
case_run "B2 visible behind, show with token" "startup:$(send show "$sock")"
pkill -f "$HERE/launcher.py"
sleep 1
eval "$(send hide "$sock")"
sleep 1
case_run "B3 hidden, show without token" "none:$(send show "$sock")"
pkill -f "$HERE/launcher.py"
eval "$(send hide "$sock")"
sleep 1
case_run "B4 hidden, show with token" "startup:$(send show "$sock")"
clean

note "C. Channels 0.27.4 (XWayland today), started by the focused app"
unset GDK_BACKEND
WAIT=14 case_run "C1 cold, no token" "none:HOME=$APPHOME /opt/Channels/bin/launcher"
clean app
WAIT=14 case_run "C2 cold, XDG_ACTIVATION_TOKEN only (Plasma), through bin/launcher" "activation:HOME=$APPHOME /opt/Channels/bin/launcher"
clean app
WAIT=14 case_run "C3 cold, DESKTOP_STARTUP_ID straight to electrobun-launcher" "startup:HOME=$APPHOME /opt/Channels/bin/electrobun-launcher"
clean
case_run "C4 running behind, second start with a token" "startup:HOME=$APPHOME /opt/Channels/bin/launcher"
clean
case_run "C5 running behind, second start without a token" "none:HOME=$APPHOME /opt/Channels/bin/launcher"
clean app
note "focus done"
