#!/usr/bin/env bash
set -u

usage="usage: raise.sh HOME RESULTS LOGS (as the desktop user, under dbus-run-session, after a start wrote the desktop entry)"
home=${1:?$usage}
results=${2:?$usage}
logs=${3:?$usage}
tag=raise
here=$(cd "$(dirname "$0")" && pwd)
ok() { echo "ok   [$tag] $*" | tee -a "$results"; }
bad() { echo "FAIL [$tag] $*" | tee -a "$results"; }
info() { echo "     [$tag] $*" | tee -a "$results"; }

kwin_log="$logs/$tag-kwin.log"
unset DISPLAY XDG_CURRENT_DESKTOP KDE_FULL_SESSION KDE_SESSION_VERSION
QT_LOGGING_RULES="kwin_scripting.debug=true;kwin_core.debug=true" kwin_wayland --virtual --no-lockscreen --socket kiwi-raise --width 1280 --height 800 > "$kwin_log" 2>&1 &
kwin=$!
for _ in $(seq 1 100); do [ -S "$XDG_RUNTIME_DIR/kiwi-raise" ] && break; sleep 0.2; done
[ -S "$XDG_RUNTIME_DIR/kiwi-raise" ] || { bad "KWin didn't start: $(tail -n 3 "$kwin_log" | tr '\n' ' ' | cut -c1-300)"; exit 0; }
export HOME="$home" WAYLAND_DISPLAY=kiwi-raise XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6 GSETTINGS_BACKEND=keyfile
info "$(kwin_wayland --version 2>&1 | head -n 1) on native Wayland, with focus stealing prevention as Plasma ships it"

active() { python3 "$here/kwin.py" active "$kwin_log"; }
front() { python3 "$here/kwin.py" front "$kwin_log"; }
heard() {
  local n
  n=$(grep -c "Channels: opening a kiwi:// link" "$logs/$tag-app.log" 2> /dev/null)
  echo "${n:-0}"
}
wait_heard() {
  for _ in $(seq 1 "$2"); do [ "$(heard)" -ge "$1" ] && return 0; sleep 1; done
  return 1
}
wait_active() {
  local now
  for _ in $(seq 1 "$2"); do
    now=$(active)
    case "${now%% of *}" in *"$1"*) return 0 ;; esac
    sleep 1
  done
  echo "$now"
  return 1
}
activations() { grep -iE 'activat|token' "$kwin_log" | tail -n 4 | tr '\n' ' ' | cut -c1-500; }

setsid xdg-open "kiwi://join/mc2-raise-cold" > "$logs/$tag-app.log" 2>&1 &
if ! wait_heard 1 60; then
  bad "with the app closed, xdg-open 'kiwi://join/…' didn't start it under KWin: $(grep -m3 -E 'Channels|kde-open|error' "$logs/$tag-app.log" | tr '\n' ' ' | cut -c1-300)"
  kill "$kwin" 2> /dev/null
  exit 0
fi
for _ in $(seq 1 30); do case "$(active)" in *" of "*Channels*) break ;; esac; sleep 1; done
info "the app is up: $(active)"

trigger=$(mktemp -u)
python3 "$here/browser.py" "$trigger" > "$logs/$tag-browser.log" 2>&1 &
browser=$!
for _ in $(seq 1 30); do case "$(active)" in *kiwi-browser*) break ;; esac; sleep 1; done

for how in xdg-open gio; do
  url="kiwi://join/mc2-raise-$how"
  now=$(front)
  case "$now" in
    kiwi-browser*) ;;
    *)
      bad "couldn't put another window in front of Channels before $how: $now"
      continue
      ;;
  esac
  before=$(heard)
  echo "$how $url" > "$trigger"
  if ! wait_heard $((before + 1)) 20; then
    bad "with another window in front, $how '$url' didn't reach the running app: $(tail -n 2 "$logs/$tag-browser.log" | tr '\n' ' ' | cut -c1-300)"
    continue
  fi
  if now=$(wait_active Channels 10); then
    ok "with another window in front, $how 'kiwi://join/…' from it brings Channels forward and focuses it"
  else
    bad "with another window in front, $how 'kiwi://join/…' opened the join in Channels but left it behind: KWin's active window is $now; $(grep -m1 "token" "$logs/$tag-browser.log" | cut -c1-200); KWin: $(activations)"
  fi
done

kill "$browser" 2> /dev/null
pkill -TERM -u "$(id -u)" -f "Channels/bin/bun" 2> /dev/null
sleep 3
pkill -KILL -u "$(id -u)" -f "appimage_extracted|Channels.AppImage|\.mount_Channel" 2> /dev/null
kill "$kwin" 2> /dev/null
exit 0
