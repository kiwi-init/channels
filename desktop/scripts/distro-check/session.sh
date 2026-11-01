#!/usr/bin/env bash
set -u

usage="usage: session.sh none|gnome-keyring|kwallet|kwallet-unanswered|cancel|cancel-no-keyring|cancel-holds-key TAG APPIMAGE RESULTS LOGS tray|no-tray [HOME] [extract|entry] (as the desktop user, under dbus-run-session)"
keyring=${1:?$usage}
tag=${2:?$usage}
image=${3:?$usage}
results=${4:?$usage}
logs=${5:?$usage}
tray=${6:?$usage}
kept_home=${7:-}
launch=${8:-extract}
here=$(cd "$(dirname "$0")" && pwd)
ok() { echo "ok   [$tag] $*" | tee -a "$results"; }
bad() { echo "FAIL [$tag] $*" | tee -a "$results"; }
info() { echo "     [$tag] $*" | tee -a "$results"; }

weston --backend=headless --socket=kiwi --width=1280 --height=800 --idle-time=0 --renderer=pixman --debug > "$logs/$tag-weston.log" 2>&1 &
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
  kwallet-unanswered)
    export XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
    daemon=$(command -v ksecretd || command -v kwalletd6)
    HOME=$(mktemp -d) QT_QPA_PLATFORM=offscreen "$daemon" > "$logs/$tag-wallet.log" 2>&1 &
    sleep 3
    info "$(basename "$daemon") with no wallet yet: its first-use dialog is offscreen, so nobody answers it"
    ;;
  cancel | cancel-no-keyring | cancel-holds-key)
    python3 "$here/secrets-cancel.py" "$(case "$keyring" in cancel-holds-key) echo holds-key ;; cancel-no-keyring) echo no-keyring ;; *) echo locked ;; esac)" > "$logs/$tag-secrets.log" 2>&1 &
    sleep 1
    info "a Secret Service whose every prompt is cancelled, as a person clicking Cancel does: $(head -n 1 "$logs/$tag-secrets.log")"
    ;;
esac
owner=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetNameOwner org.freedesktop.secrets 2> /dev/null)
info "Secret Service: ${owner:-nobody owns org.freedesktop.secrets}"

home=${kept_home:-$(mktemp -d)}
export GSETTINGS_BACKEND=keyfile
python3 -c '
import sys
w, h = 1280, 800
px = bytearray()
for y in range(h):
    row = bytes([240, 120, 30]) * (w // 2) + bytes([40, 90, 230]) * (w - w // 2)
    px += row
open(sys.argv[1], "wb").write(b"P6\n%d %d\n255\n" % (w, h) + bytes(px))
' "$home/wall.ppm"
HOME="$home" gsettings set org.gnome.desktop.background picture-uri "file://$home/wall.ppm" 2> /dev/null || info "no gsettings: the app has no GNOME wallpaper to draw"
HOME="$home" gsettings set org.gnome.desktop.background picture-uri-dark "file://$home/wall.ppm" 2> /dev/null || true
HOME="$home" gsettings set org.gnome.desktop.interface color-scheme prefer-dark 2> /dev/null || true
start=$(date +%s)
if [ "$launch" = entry ]; then
  exec_line=$(sed -n 's/^Exec=//p' "$home/.local/share/applications/channels-desktop.desktop" 2> /dev/null | sed 's/ %U$//')
  [ -n "$exec_line" ] || { bad "no desktop entry to start the app from"; kill "$watcher" "$proto" "$weston" 2> /dev/null; exit 0; }
  info "started the way the app menu does: $exec_line"
  HOME="$home" setsid sh -c "exec $exec_line" > "$logs/$tag-app.log" 2>&1 &
else
  HOME="$home" setsid "$image" --appimage-extract-and-run > "$logs/$tag-app.log" 2>&1 &
fi
pid=$!
up=""
for _ in $(seq 1 60); do
  grep -q 'xdg_surface.*get_toplevel' "$logs/$tag-proto.log" 2> /dev/null && { up=yes; break; }
  kill -0 "$pid" 2> /dev/null || break
  sleep 1
done
if [ -n "$up" ]; then ok "a native Wayland window (xdg_toplevel) after $(($(date +%s) - start)) s"; else bad "no Wayland window in 60 s, the app $(kill -0 "$pid" 2> /dev/null && echo "still runs" || echo "exited")"; fi
if [ "$keyring" = kwallet-unanswered ]; then
  if [ -n "$up" ] && [ $(($(date +%s) - start)) -le 10 ]; then ok "the window came without waiting on the keyring"; else bad "the window waited on a keyring that doesn't answer"; fi
  if grep -q "hasn't answered" "$logs/$tag-app.log"; then ok "the app says it's waiting for the keyring"; else bad "the app didn't say it's waiting for the keyring"; fi
fi
sleep 15
shot=$(cd "$logs" && timeout 10 weston-screenshooter > /dev/null 2>&1; ls -t wayland-screenshot-*.png 2> /dev/null | head -n 1)
if [ -n "$shot" ]; then mv "$logs/$shot" "$logs/$tag-window.png"; info "screenshot: $tag-window.png"; else info "no screenshot: weston-screenshooter didn't write one"; fi
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
if [ "$keyring" = kwallet-unanswered ] || [ "${keyring#cancel}" != "$keyring" ]; then
  :
elif [ "$registered" -gt 0 ]; then
  ok "its tray icon registered with the StatusNotifierWatcher$([ "$tray" = tray ] || echo ", with no libayatana-appindicator (Electrobun's own StatusNotifierItem)")"
else
  bad "no tray icon registered, though a watcher runs$([ "$tray" = tray ] || echo " (the tray needs no libayatana-appindicator)")"
fi

main_log=$(find "$home" -name main.log 2> /dev/null | head -n 1)
[ -z "$main_log" ] || cp "$main_log" "$logs/$tag-main.log"
plain=$(grep -h "keeps your keys in .* without encryption" "$logs/$tag-app.log" ${main_log:+"$main_log"} | head -n 1)
stored=$(timeout 20 secret-tool search --all service Channels 2>&1 | grep -E '^(label|attribute\.)' | tr '\n' ' ')
case "$keyring" in
  none)
    if [ -n "$plain" ]; then ok "no Secret Service: the app keeps its keys unencrypted (0600) and says so"; else bad "no Secret Service, and the app didn't say where its keys went"; fi
    ;;
  cancel | cancel-no-keyring | cancel-holds-key)
    info "prompts asked and cancelled: $(grep -c dismissed "$logs/$tag-secrets.log"); calls: $(grep -oE '[A-Za-z]+\.[A-Za-z]+ on' "$logs/$tag-secrets.log" | sort | uniq -c | tr -s ' ' | tr '\n' ',' | cut -c1-300)"
    info "the app said: $(grep -hE '^Channels' "$logs/$tag-app.log" | tr '\n' ' ' | cut -c1-400)"
    unsealed=$(find "$home" -name 'kiwi-store-v2.bin*' 2> /dev/null | while read -r f; do [ "$(head -c 12 "$f")" = kiwi-store/2 ] || echo "$f"; done)
    if [ -z "$plain" ] && [ -z "$unsealed" ]; then ok "with the keyring's prompt cancelled, nothing of Channels' is kept unencrypted"; else bad "with the keyring's prompt cancelled, the app kept its keys unencrypted: ${plain:-$unsealed}"; fi
    case "$tag" in
      keyless-dialog)
        if grep -q "the keyring stayed locked\|prompt was cancelled" "$logs/$tag-app.log"; then bad "a keyring that holds no key for a sealed store was taken for a locked or cancelled one"; else ok "a sealed store whose key is gone shows the can't-read dialog, not the keyring notes"; fi
        ;;
      *)
        if grep -q "the keyring stayed locked\|prompt was cancelled" "$logs/$tag-app.log"; then ok "the window says the keyring stayed locked or its prompt was cancelled, and offers to ask again: $(grep -ohE 'the keyring stayed locked|prompt was cancelled' "$logs/$tag-app.log" | sort -u | tr '\n' ',')"; else bad "the app didn't say the keyring's prompt was cancelled or stayed locked"; fi
        ;;
    esac
    ;;
  kwallet-unanswered)
    if [ -n "$plain" ]; then bad "while the keyring hasn't answered, the app kept its keys unencrypted: $(echo "$plain" | cut -c1-160)"; else ok "while the keyring hasn't answered, the app keeps no keys unencrypted"; fi
    ;;
  *)
    if [ -n "$stored" ]; then ok "its store key is in the Secret Service ($keyring): $(echo "$stored" | cut -c1-200)"; else bad "nothing of Channels' in the Secret Service ($keyring)${plain:+; the app says: $(echo "$plain" | cut -c1-160)}"; fi
    ;;
esac
if [ "$tag" = migrate ]; then
  stores=$(find "$home" -name 'kiwi-store-v2.bin*' 2> /dev/null)
  unsealed=$(for f in $stores; do [ "$(head -c 12 "$f")" = kiwi-store/2 ] || echo "$f"; done)
  if [ -n "$stores" ] && [ -z "$unsealed" ]; then ok "the plain store a start without a keyring left is sealed once a keyring answers"; else bad "the plain store wasn't sealed once a keyring answered: ${unsealed:-no store}"; fi
fi
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
[ -n "$kept_home" ] || rm -rf "$home"
