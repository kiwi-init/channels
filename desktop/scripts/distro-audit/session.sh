#!/usr/bin/env bash
set -u
KEYRING=$1
OUT=$2
TAG=$3
APPDIR=$4
HERE=$(cd "$(dirname "$0")" && pwd)
note() { echo "== [$TAG] $*" | tee -a "$OUT/notes.txt"; }
weston --backend=headless --socket=kiwi --width=1280 --height=800 --idle-time=0 > "$OUT/$TAG-weston.log" 2>&1 &
weston=$!
for _ in $(seq 1 50); do [ -S "$XDG_RUNTIME_DIR/kiwi" ] && break; sleep 0.2; done
[ -S "$XDG_RUNTIME_DIR/kiwi" ] || { note "weston didn't start: $(tail -n 3 "$OUT/$TAG-weston.log")"; exit 1; }
export WAYLAND_DISPLAY=kiwi XDG_SESSION_TYPE=wayland
python3 "$HERE/watcher.py" >> "$OUT/$TAG-watcher.log" 2>&1 &
watcher=$!
case "$KEYRING" in
  gnome-keyring)
    eval "$(printf throwaway | gnome-keyring-daemon --unlock --components=secrets 2> /dev/null)"
    export GNOME_KEYRING_CONTROL
    ;;
  kwallet)
    export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
    for d in ksecretd kwalletd6; do command -v "$d" > /dev/null && { QT_QPA_PLATFORM=offscreen "$d" > "$OUT/$TAG-$d.log" 2>&1 & note "started $d"; break; }; done
    sleep 3
    ;;
esac
note "secret service owner: $(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetNameOwner org.freedesktop.secrets 2>&1 | head -c 120)"
home=$(mktemp -d)
start=$(date +%s)
HOME="$home" WAYLAND_DEBUG=client setsid "$APPDIR/bin/electrobun-launcher" > "$OUT/$TAG-app.log" 2>&1 &
pid=$!
up=""
for _ in $(seq 1 60); do
  grep -qE 'get_toplevel\(new id xdg_toplevel' "$OUT/$TAG-app.log" && { up=1; break; }
  kill -0 "$pid" 2> /dev/null || break
  sleep 1
done
if [ -n "$up" ]; then note "Wayland window up after $(($(date +%s) - start)) s"; else note "NO WINDOW in 60 s (app $(kill -0 "$pid" 2> /dev/null && echo running || echo exited))"; fi
if [ -z "$up" ] && kill -0 "$pid" 2> /dev/null; then
  for p in $(pgrep -s "$pid"); do note "stuck process $p $(tr '\0' ' ' < "/proc/$p/cmdline" | cut -c1-80): $(cat "/proc/$p/wchan" 2> /dev/null)"; done
  [ "$KEYRING" = kwallet ] && note "ksecretd/kwalletd log: $(tail -n 8 "$OUT/$TAG-"k*d*.log 2> /dev/null | tr '\n' ' ' | cut -c1-600)"
fi
sleep 10
note "app $(kill -0 "$pid" 2> /dev/null && echo "still running" || echo "EXITED"); web process: $(pgrep -s "$pid" -f WebKitWebProcess | head -n 1 || echo none)"
note "Secret Service items:"
timeout 30 python3 "$HERE/secrets.py" 2>&1 | tail -n 6 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
note "the app's store lines:"
find "$home" -name main.log -exec grep -ihE 'store|keychain|secret|plain|wallet|key' {} + 2> /dev/null | head -n 10 | cut -c1-300 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
note "tray: $(grep -c 'RegisterStatusNotifierItem' "$OUT/$TAG-watcher.log") registrations"
note "app output (not protocol), errors and warnings:"
grep -vE '^\[[ 0-9.]+\]' "$OUT/$TAG-app.log" | grep -iE 'error|warn|fail|cannot|not found|critical|refus|missing' | sort | uniq -c | sort -rn | head -n 15 | cut -c1-240 | sed 's/^/   /' | tee -a "$OUT/notes.txt"
kill -TERM -- "-$pid" 2> /dev/null
sleep 3
kill -KILL -- "-$pid" 2> /dev/null
kill "$watcher" "$weston" 2> /dev/null
gzip -f "$OUT/$TAG-app.log"
chmod -R a+r "$OUT" 2> /dev/null
note "done"
