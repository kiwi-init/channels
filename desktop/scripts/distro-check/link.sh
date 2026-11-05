#!/usr/bin/env bash
set -u

usage="usage: link.sh HOME RESULTS LOGS [TAG] (as the desktop user, under dbus-run-session, after a start wrote the desktop entry)"
home=${1:?$usage}
results=${2:?$usage}
logs=${3:?$usage}
tag=${4:-link}
ok() { echo "ok   [$tag] $*" | tee -a "$results"; }
bad() { echo "FAIL [$tag] $*" | tee -a "$results"; }
info() { echo "     [$tag] $*" | tee -a "$results"; }

weston --backend=headless --socket=kiwi-link --width=1280 --height=800 --idle-time=0 --renderer=pixman > "$logs/$tag-weston.log" 2>&1 &
weston=$!
for _ in $(seq 1 50); do [ -S "$XDG_RUNTIME_DIR/kiwi-link" ] && break; sleep 0.2; done
[ -S "$XDG_RUNTIME_DIR/kiwi-link" ] || { bad "weston didn't start"; exit 0; }
export HOME="$home" WAYLAND_DISPLAY=kiwi-link XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE KDE_FULL_SESSION=true KDE_SESSION_VERSION=6 GSETTINGS_BACKEND=keyfile
info "x-scheme-handler/kiwi: $(xdg-mime query default x-scheme-handler/kiwi 2>&1 | head -n 1)"
heard() {
  local n
  n=$(grep -c "Channels: opening a kiwi:// link" "$logs/$tag-app.log" 2> /dev/null)
  echo "${n:-0}"
}
wait_heard() {
  for _ in $(seq 1 "$2"); do [ "$(heard)" -ge "$1" ] && return 0; sleep 1; done
  return 1
}

setsid xdg-open "kiwi://join/mc2-distro-cold" > "$logs/$tag-app.log" 2>&1 &
if wait_heard 1 60; then
  ok "with the app closed, xdg-open on KDE starts it from its entry and the app opens the link"
else
  bad "with the app closed, xdg-open 'kiwi://join/…' didn't reach the app: $(grep -m3 -E 'Channels|kde-open|error' "$logs/$tag-app.log" | tr '\n' ' ' | cut -c1-300)"
fi
sleep 5
before=$(heard)
xdg-open "kiwi://join/mc2-distro-warm" > "$logs/$tag-second.log" 2>&1
if wait_heard $((before + 1)) 20; then
  ok "with the app running, xdg-open hands the link to the open app"
else
  bad "with the app running, xdg-open 'kiwi://join/…' didn't reach it: $(tail -n 3 "$logs/$tag-second.log" | tr '\n' ' ' | cut -c1-300)"
fi
before=$(heard)
gio open "kiwi://join/mc2-distro-gio" > "$logs/$tag-gio.log" 2>&1
if wait_heard $((before + 1)) 20; then
  ok "and gio open, as GTK browsers open links, does too"
else
  bad "gio open 'kiwi://join/…' didn't reach the running app: $(tail -n 3 "$logs/$tag-gio.log" | tr '\n' ' ' | cut -c1-300)"
fi

if command -v firefox > /dev/null; then
  profile=$(mktemp -d)
  printf '%s\n' \
    'user_pref("network.protocol-handler.external.kiwi", true);' \
    'user_pref("network.protocol-handler.warn-external.kiwi", false);' \
    'user_pref("security.external_protocol_requires_permission", false);' \
    'user_pref("browser.shell.checkDefaultBrowser", false);' > "$profile/user.js"
  before=$(heard)
  MOZ_HEADLESS=1 timeout 40 firefox --no-remote --profile "$profile" "kiwi://join/mc2-distro-firefox" > "$logs/$tag-firefox.log" 2>&1 &
  browser=$!
  if wait_heard $((before + 1)) 30; then
    ok "and Firefox, opening a kiwi:// link with the handler allowed, hands it to the running app"
  else
    bad "Firefox opened kiwi://join/… and the running app never got it: $(tail -n 3 "$logs/$tag-firefox.log" | tr '\n' ' ' | cut -c1-300)"
  fi
  kill "$browser" 2> /dev/null
  pkill -u "$(id -u)" -f "firefox.*$profile" 2> /dev/null
else
  info "no Firefox here, so no browser handoff was tried"
fi

pkill -TERM -u "$(id -u)" -f "Channels/bin/bun" 2> /dev/null
sleep 3
pkill -KILL -u "$(id -u)" -f "appimage_extracted|Channels.AppImage" 2> /dev/null
kill "$weston" 2> /dev/null
exit 0
