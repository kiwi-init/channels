#!/usr/bin/env bash
set -u

usage="usage: session.sh none|gnome-keyring|kwallet TAG APPIMAGE RESULTS LOGS tray|no-tray (as the desktop user, under dbus-run-session)"
keyring=${1:?$usage}
tag=${2:?$usage}
image=${3:?$usage}
results=${4:?$usage}
logs=${5:?$usage}
tray=${6:?$usage}
here=$(cd "$(dirname "$0")" && pwd)
ok() { echo "ok   [$tag] $*" | tee -a "$results"; }
bad() { echo "FAIL [$tag] $*" | tee -a "$results"; }
info() { echo "     [$tag] $*" | tee -a "$results"; }

weston --backend=headless --socket=kiwi --width=1280 --height=800 --idle-time=0 --debug > "$logs/$tag-weston.log" 2>&1 &
weston=$!
for _ in $(seq 1 50); do [ -S "$XDG_RUNTIME_DIR/kiwi" ] && break; sleep 0.2; done
[ -S "$XDG_RUNTIME_DIR/kiwi" ] || { bad "weston didn't start: $(tail -n 3 "$logs/$tag-weston.log" | tr '\n' ' ')"; exit 0; }
export WAYLAND_DISPLAY=kiwi XDG_SESSION_TYPE=wayland
WAYLAND_DISPLAY=kiwi weston-debug proto > "$logs/$tag-proto.log" 2>&1 &
proto=$!
python3 "$here/watcher.py" > "$logs/$tag-watcher.log" 2>&1 &
watcher=$!
case "$keyring" in
  gnome-keyring)
    eval "$(printf throwaway | gnome-keyring-daemon --unlock --components=secrets 2> /dev/null)"
    export GNOME_KEYRING_CONTROL
    ;;
  kwallet)
    export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
    daemon=$(command -v ksecretd || command -v kwalletd6)
    python3 "$here/kwallet-login.py" "$daemon" "$logs/$tag-wallet.log"
    for _ in $(seq 1 50); do grep -q "opened by PAM" "$logs/$tag-wallet.log" && break; sleep 0.2; done
    info "$(basename "$daemon"), its wallet made and opened at login as kwallet-pam does: $(grep -m1 -E "opened by PAM|PAM" "$logs/$tag-wallet.log" | cut -c1-120)"
    ;;
esac
owner=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetNameOwner org.freedesktop.secrets 2> /dev/null)
info "Secret Service: ${owner:-nobody owns org.freedesktop.secrets}"

home=$(mktemp -d)
start=$(date +%s)
HOME="$home" setsid "$image" --appimage-extract-and-run > "$logs/$tag-app.log" 2>&1 &
pid=$!
up=""
for _ in $(seq 1 60); do
  grep -q 'xdg_surface.*get_toplevel' "$logs/$tag-proto.log" 2> /dev/null && { up=yes; break; }
  kill -0 "$pid" 2> /dev/null || break
  sleep 1
done
if [ -n "$up" ]; then ok "a native Wayland window (xdg_toplevel) after $(($(date +%s) - start)) s"; else bad "no Wayland window in 60 s, the app $(kill -0 "$pid" 2> /dev/null && echo "still runs" || echo "exited")"; fi
sleep 15
if kill -0 "$pid" 2> /dev/null; then ok "still running 15 s later"; else bad "the app exited: $(tail -n 5 "$logs/$tag-app.log" | tr '\n' ' ' | cut -c1-300)"; fi

web=$(pgrep -s "$pid" -x WebKitWebProces | head -n 1)
boxed=""
upid=$web
while [ -n "$upid" ] && [ "$upid" -gt 1 ] && [ "$upid" != "$pid" ]; do
  upid=$(ps -o ppid= -p "$upid" | tr -d ' ')
  [ -n "$upid" ] && [ "$(ps -o comm= -p "$upid")" = bwrap ] && boxed=$upid
done
if [ -z "$web" ]; then bad "no WebKitWebProcess of the app's"; elif [ -n "$boxed" ]; then ok "its web process runs in WebKitGTK's bubblewrap sandbox (bwrap $boxed)"; else bad "its web process $web runs without bwrap: $(grep -h "sandbox is off" "$logs/$tag-app.log" | head -n 1 | cut -c1-200)"; fi

registered=$(grep -c 'RegisterStatusNotifierItem' "$logs/$tag-watcher.log")
if [ "$tray" = tray ]; then
  if [ "$registered" -gt 0 ]; then ok "its tray icon registered with the StatusNotifierWatcher"; else bad "no tray icon registered, though libayatana-appindicator is installed and a watcher runs"; fi
elif [ "$registered" -eq 0 ]; then
  ok "no tray icon, as expected without libayatana-appindicator, and the app runs on"
else
  bad "a tray icon registered without libayatana-appindicator"
fi

main_log=$(find "$home" -name main.log 2> /dev/null | head -n 1)
[ -z "$main_log" ] || cp "$main_log" "$logs/$tag-main.log"
plain=$(grep -h "No secret service answered" "$logs/$tag-app.log" ${main_log:+"$main_log"} | head -n 1)
stored=$(timeout 20 secret-tool search --all service Channels 2>&1 | grep -E '^(label|attribute\.)' | tr '\n' ' ')
case "$keyring" in
  none)
    if [ -n "$plain" ]; then ok "no Secret Service: the app keeps its keys unencrypted (0600) and says so"; else bad "no Secret Service, and the app didn't say where its keys went"; fi
    ;;
  *)
    if [ -n "$stored" ]; then ok "its store key is in the Secret Service ($keyring): $(echo "$stored" | cut -c1-200)"; else bad "nothing of Channels' in the Secret Service ($keyring)${plain:+; the app says: $(echo "$plain" | cut -c1-160)}"; fi
    ;;
esac
grep -iE 'error|critical|fail' "$logs/$tag-app.log" | grep -viE 'AT-SPI|DRI3|GLXBadWindow|dbind-WARNING' | sort | uniq -c | sort -rn | head -n 8 | cut -c1-220 | while IFS= read -r line; do info "app said: $line"; done

alive() { ps -e -o pid=,sid=,stat=,args= | awk -v s="$pid" '$2 == s && $3 !~ /^Z/' | cut -c1-120; }
kill -TERM -- "-$pid" 2> /dev/null
for _ in $(seq 1 20); do [ -z "$(alive)" ] && break; sleep 0.5; done
if [ -n "$(alive)" ]; then
  bad "still running 10 s after SIGTERM: $(alive | tr '\n' ';')"
  kill -KILL -- "-$pid" 2> /dev/null
else
  ok "stopped cleanly on SIGTERM"
fi
kill "$watcher" "$proto" "$weston" 2> /dev/null
rm -rf "$home"
