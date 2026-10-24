#!/usr/bin/env bash
set -u
D=$1
OUT=$2
TAG=$3
APP=$4
HERE=$(cd "$(dirname "$0")" && pwd)
note() { echo "== [$TAG] $*" | tee -a "$OUT/notes.txt"; }
note "session WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} DISPLAY=${DISPLAY:-} XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-}"
python3 "$HERE/watcher.py" >> "$OUT/$TAG-watcher.log" 2>&1 &
watcher=$!
if [ "$D" = gnome ]; then
  eval "$(printf throwaway | gnome-keyring-daemon --unlock --components=secrets 2> /dev/null)"
  export GNOME_KEYRING_CONTROL
fi
note "activatable secrets: $(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ListActivatableNames 2>&1 | grep -oE "'org\.(freedesktop\.secrets|kde\.kwalletd[0-9]*|kde\.secretservicecompat|freedesktop\.Notifications)'" | tr '\n' ' ')"
note "Secret Service before: $(timeout 20 python3 "$HERE/secrets.py" 2>&1 | tail -n 3 | tr '\n' ';')"
home=$(mktemp -d)
HOME="$home" setsid "$APP" > "$OUT/$TAG-app.log" 2>&1 &
pid=$!
up=""
for _ in $(seq 1 45); do
  kill -0 "$pid" 2> /dev/null || break
  if [ "$D" = gnome ]; then
    python3 "$HERE/probe.py" gnome-windows 2> /dev/null | grep -q '"title": "Channels"' && up=1
  else
    before=$(wc -l < "$KWIN_LOG")
    python3 "$HERE/probe.py" kwin-script "$HERE/list.js" > /dev/null 2>&1
    sleep 0.5
    tail -n +"$((before + 1))" "$KWIN_LOG" | grep -q '"caption":"Channels"' && up=1
  fi
  [ -n "$up" ] && break
  sleep 1
done
if [ -n "$up" ]; then note "window up"; else note "NO WINDOW in 45 s (app $(kill -0 "$pid" 2> /dev/null && echo running || echo exited))"; fi
sleep 8
if [ "$D" = gnome ]; then
  python3 "$HERE/probe.py" gnome-windows 2>&1 | head -c 600 | sed 's/^/   windows: /' | tee -a "$OUT/notes.txt"
  echo | tee -a "$OUT/notes.txt"
else
  before=$(wc -l < "$KWIN_LOG")
  python3 "$HERE/probe.py" kwin-script "$HERE/list.js" > /dev/null 2>&1
  sleep 1
  tail -n +"$((before + 1))" "$KWIN_LOG" | grep -o 'kiwi-win {.*' | cut -c1-300 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
fi
note "app $(kill -0 "$pid" 2> /dev/null && echo "still running" || echo "EXITED")"
note "Secret Service after:"
timeout 30 python3 "$HERE/secrets.py" 2>&1 | tail -n 8 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
note "the app's store lines:"
find "$home" -name main.log -exec grep -ihE 'store|keychain|secret|plain|wallet' {} + 2> /dev/null | head -n 10 | cut -c1-300 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
note "tray: $(grep -c 'RegisterStatusNotifierItem' "$OUT/$TAG-watcher.log") registrations; $(grep RegisterStatusNotifierItem "$OUT/$TAG-watcher.log" | head -n 1)"
note "app output (not protocol):"
grep -vE '^\[[ 0-9.]+\]' "$OUT/$TAG-app.log" | grep -iE 'error|warn|fail|cannot|not found|critical|refus' | sort | uniq -c | sort -rn | head -n 15 | cut -c1-240 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
kill -TERM -- "-$pid" 2> /dev/null
sleep 3
kill -KILL -- "-$pid" 2> /dev/null
kill "$watcher" 2> /dev/null
note "done"
