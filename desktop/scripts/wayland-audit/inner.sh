#!/usr/bin/env bash
set -u
D=$1
OUT=$2
TAG=$3
HERE=$(cd "$(dirname "$0")" && pwd)
APPHOME=$(mktemp -d)
mkdir -p "$APPHOME/.local/share/applications"
note() { echo "== $*" | tee -a "$OUT/notes.txt"; }
[ "$D" = kde ] && export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6 && unset QT_QPA_PLATFORMTHEME

shot() {
  if [ "$D" = gnome ]; then python3 "$HERE/probe.py" gnome-shot "$OUT/$TAG-$1.png" >> "$OUT/probe.log" 2>&1; else python3 "$HERE/probe.py" kwin-shot "$OUT/$TAG-$1.png" >> "$OUT/probe.log" 2>&1; fi
  if [ ! -s "$OUT/$TAG-$1.png" ] && [ -n "${DISPLAY:-}" ]; then
    for id in $(xdotool search --name '^Channels$' 2> /dev/null); do
      xwd -silent -id "$id" 2>> "$OUT/probe.log" | convert xwd:- "$OUT/$TAG-$1-x11-$id.png" 2>> "$OUT/probe.log"
    done
  fi
  note "shot $TAG-$1 $(ls "$OUT/$TAG-$1"*.png 2> /dev/null | xargs -n1 basename 2> /dev/null | tr '\n' ' ')"
}

windows() {
  if [ "$D" = gnome ]; then
    python3 "$HERE/probe.py" gnome-windows > "$OUT/$TAG-$1-windows.json" 2>> "$OUT/probe.log"
    python3 - "$OUT/$TAG-$1-windows.json" << 'EOF' | tee -a "$OUT/notes.txt"
import json, sys
try:
    ws = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"   windows unreadable: {e}")
    raise SystemExit
for wid, w in ws.items():
    print(f"   win {wid}: title={w.get('title')!r} app-id={w.get('app-id')!r} wm-class={w.get('wm-class')!r} client-type={w.get('client-type')} focus={w.get('has-focus')} hidden={w.get('is-hidden')} size={w.get('width')}x{w.get('height')}")
EOF
  else
    local before
    before=$(wc -l < "$KWIN_LOG")
    python3 "$HERE/probe.py" kwin-script "$HERE/list.js" >> "$OUT/probe.log" 2>&1
    sleep 1
    tail -n +"$((before + 1))" "$KWIN_LOG" | grep -o 'kiwi-win .*' | sed 's/^/   /' | tee -a "$OUT/notes.txt" > "$OUT/$TAG-$1-windows.txt"
  fi
}

focused() {
  if [ "$D" = gnome ]; then
    python3 "$HERE/probe.py" gnome-windows 2> /dev/null | python3 -c 'import json,sys; ws=json.load(sys.stdin); print(" ".join(repr(w.get("title")) for w in ws.values() if w.get("has-focus")) or "nothing")' 2> /dev/null
    echo " x11-active=$(xprop -root _NET_ACTIVE_WINDOW 2> /dev/null | awk '{print $NF}') channels=$(xdotool search --classname '^Channels$' 2> /dev/null | tr '\n' ',')"
  else
    local before
    before=$(wc -l < "$KWIN_LOG")
    python3 "$HERE/probe.py" kwin-script "$HERE/list.js" > /dev/null 2>&1
    sleep 1
    tail -n +"$((before + 1))" "$KWIN_LOG" | grep -o 'kiwi-win .*"active":true[^}]*' | grep -o '"caption":"[^"]*"' || echo nothing
  fi
}

wait_window() {
  for _ in $(seq 1 60); do
    if [ "$D" = gnome ]; then
      python3 "$HERE/probe.py" gnome-windows 2> /dev/null | grep -q '"title": "Channels"' && return 0
      xdotool search --classname '^Channels$' > /dev/null 2>&1 && return 0
    else
      local before
      before=$(wc -l < "$KWIN_LOG")
      python3 "$HERE/probe.py" kwin-script "$HERE/list.js" > /dev/null 2>&1
      sleep 0.5
      tail -n +"$((before + 1))" "$KWIN_LOG" | grep -q '"caption":"Channels"' && return 0
    fi
    sleep 1
  done
  return 1
}

app_env() {
  local pid
  pid=$(pgrep -f '/opt/Channels/bin/bun' | head -n 1)
  [ -n "$pid" ] || { note "no app bun process"; return; }
  note "app env ($1), pid $pid:"
  tr '\0' '\n' < "/proc/$pid/environ" | grep -E '^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DESKTOP_STARTUP_ID|XDG_ACTIVATION_TOKEN|XDG_CURRENT_DESKTOP|XDG_SESSION_TYPE|GDK_BACKEND|GTK_|XCURSOR|GDK_)' | sed 's/^/   /' | tee -a "$OUT/notes.txt"
}

stop_app() {
  pkill -TERM -f '/opt/Channels/bin/' 2> /dev/null
  for _ in $(seq 1 20); do pgrep -f '/opt/Channels/bin/' > /dev/null || break; sleep 0.5; done
  pkill -KILL -f '/opt/Channels/bin/' 2> /dev/null
  sleep 1
}

x11_props() {
  [ -n "${DISPLAY:-}" ] || return
  local id
  id=$(xdotool search --classname '^Channels$' 2> /dev/null | head -n 1)
  [ -n "$id" ] || { note "no X11 window of class Channels"; return; }
  note "X11 window $id props:"
  xprop -id "$id" WM_CLASS _MOTIF_WM_HINTS _GTK_FRAME_EXTENTS _NET_WM_STATE _GTK_APPLICATION_ID _NET_WM_PID 2>&1 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
}

note "session $D/$TAG: WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} DISPLAY=${DISPLAY:-} XAUTHORITY=${XAUTHORITY:-} XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-}"
python3 "$HERE/probe.py" names > "$OUT/$TAG-names-start.json" 2>> "$OUT/probe.log"
note "bus names at start: $(cat "$OUT/$TAG-names-start.json")"

note "1. cold start from a plain shell"
env HOME="$APPHOME" /opt/Channels/bin/launcher >> "$OUT/$TAG-app.log" 2>&1 &
if wait_window; then note "window up"; else note "NO WINDOW in 60 s"; fi
sleep 8
shot 01-start
windows 01
x11_props
app_env "plain start"
python3 "$HERE/probe.py" names > "$OUT/$TAG-names-app.json" 2>> "$OUT/probe.log"
note "bus names with the app: $(cat "$OUT/$TAG-names-app.json")"
[ "$TAG" = main ] || { stop_app; note "done ($TAG)"; exit 0; }

if [ "$D" = gnome ]; then
  note "2a. what a WebKitGTK page sees for prefers-color-scheme"
  for backend in x11 wayland; do
    gsettings reset org.gnome.desktop.interface gtk-theme
    gsettings reset org.gnome.desktop.interface color-scheme
    sleep 2
    GDK_BACKEND=$backend timeout 30 python3 "$HERE/dark.py" "$backend default" 2>> "$OUT/probe.log" | tee -a "$OUT/notes.txt"
    gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    sleep 2
    GDK_BACKEND=$backend timeout 30 python3 "$HERE/dark.py" "$backend color-scheme=prefer-dark (GNOME's Appearance: Dark)" 2>> "$OUT/probe.log" | tee -a "$OUT/notes.txt"
    gsettings set org.gnome.desktop.interface gtk-theme Adwaita-dark
    sleep 2
    GDK_BACKEND=$backend timeout 30 python3 "$HERE/dark.py" "$backend color-scheme=prefer-dark + gtk-theme=Adwaita-dark" 2>> "$OUT/probe.log" | tee -a "$OUT/notes.txt"
  done
  gsettings reset org.gnome.desktop.interface gtk-theme
  gsettings reset org.gnome.desktop.interface color-scheme
  note "2. dark: color-scheme prefer-dark (what GNOME's Appearance panel sets)"
  gsettings set org.gnome.desktop.interface color-scheme prefer-dark
  sleep 4
  python3 "$HERE/probe.py" portal-setting org.freedesktop.appearance color-scheme >> "$OUT/notes.txt" 2>&1
  shot 02-dark-color-scheme
  note "3. dark: gtk-theme Adwaita-dark as well"
  gsettings set org.gnome.desktop.interface gtk-theme Adwaita-dark
  sleep 4
  shot 03-dark-gtk-theme
  gsettings reset org.gnome.desktop.interface gtk-theme
  gsettings reset org.gnome.desktop.interface color-scheme
  sleep 2
fi

note "4. another app takes focus, then Channels is launched again (second instance hands off 'show')"
python3 "$HERE/other.py" >> "$OUT/$TAG-other.log" 2>&1 &
other=$!
sleep 4
note "focused with the other window up: $(focused)"
env HOME="$APPHOME" /opt/Channels/bin/launcher >> "$OUT/$TAG-app.log" 2>&1
sleep 3
note "focused after relaunch from a shell: $(focused)"
shot 04-relaunch
cp /usr/share/applications/channels-desktop.desktop "$APPHOME/.local/share/applications/kiwi-envdump.desktop"
sed -i "s|^Exec=.*|Exec=sh -c 'env > $OUT/$TAG-launch-env.txt'|; s|^Name=.*|Name=envdump|" "$APPHOME/.local/share/applications/kiwi-envdump.desktop"
HOME="$APPHOME" XDG_DATA_HOME="$APPHOME/.local/share" gtk-launch kiwi-envdump >> "$OUT/probe.log" 2>&1
sleep 2
note "what gtk-launch hands an app: $(grep -E '^(DESKTOP_STARTUP_ID|XDG_ACTIVATION_TOKEN)=' "$OUT/$TAG-launch-env.txt" 2> /dev/null | tr '\n' ' ')"
HOME="$APPHOME" XDG_DATA_HOME="$APPHOME/.local/share" gtk-launch channels-desktop >> "$OUT/probe.log" 2>&1
sleep 3
note "focused after relaunch through gtk-launch: $(focused)"

note "5. close the window"
if [ "$D" = gnome ]; then
  id=$(xdotool search --name '^Channels$' 2> /dev/null | head -n 1)
  [ -n "$id" ] && xdotool windowactivate "$id" 2> /dev/null
  wmctrl -c Channels 2>&1 | tee -a "$OUT/notes.txt"
else
  python3 "$HERE/probe.py" kwin-script "$HERE/close.js" >> "$OUT/probe.log" 2>&1
fi
sleep 3
note "app processes after close: $(pgrep -fc '/opt/Channels/bin/')"
windows 05-closed
python3 "$HERE/probe.py" names > "$OUT/$TAG-names-closed.json" 2>> "$OUT/probe.log"
note "bus names after close: $(cat "$OUT/$TAG-names-closed.json")"
shot 05-closed
env HOME="$APPHOME" /opt/Channels/bin/launcher >> "$OUT/$TAG-app.log" 2>&1
sleep 4
note "after a relaunch: focused $(focused)"
windows 06-reopened
shot 06-reopened

note "6. cold start through gtk-launch, with the other window focused (our launcher drops DESKTOP_STARTUP_ID)"
stop_app
note "focused before: $(focused)"
HOME="$APPHOME" XDG_DATA_HOME="$APPHOME/.local/share" gtk-launch channels-desktop >> "$OUT/probe.log" 2>&1
if wait_window; then note "window up"; else note "NO WINDOW in 60 s"; fi
sleep 6
note "focused after a cold gtk-launch through bin/launcher: $(focused)"
app_env "gtk-launch, bin/launcher"
shot 07-cold-launcher
stop_app
sed "s|/opt/Channels/bin/launcher|/opt/Channels/bin/electrobun-launcher|; s|^Name=.*|Name=direct|" /usr/share/applications/channels-desktop.desktop > "$APPHOME/.local/share/applications/kiwi-direct.desktop"
HOME="$APPHOME" XDG_DATA_HOME="$APPHOME/.local/share" gtk-launch kiwi-direct >> "$OUT/probe.log" 2>&1
if wait_window; then note "window up"; else note "NO WINDOW in 60 s"; fi
sleep 6
note "focused after a cold gtk-launch straight to electrobun-launcher (keeps DESKTOP_STARTUP_ID): $(focused)"
app_env "gtk-launch, electrobun-launcher"
shot 08-cold-direct
stop_app
kill "$other" 2> /dev/null
note "done ($TAG)"
