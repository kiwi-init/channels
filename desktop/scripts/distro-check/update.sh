#!/usr/bin/env bash
set -u

usage="usage: update.sh FROM_VERSION RESULTS LOGS (as the desktop user, under dbus-run-session)"
from=${1:?$usage}
results=${2:?$usage}
logs=${3:?$usage}
ok() { echo "ok   [update] $*" | tee -a "$results"; }
bad() { echo "FAIL [update] $*" | tee -a "$results"; }
release=https://github.com/kiwi-init/channels/releases

to=$(curl -fsSI "$release/latest" | awk -F/ 'tolower($1) ~ /^location:/ { print $NF }' | tr -d '\r' | sed 's/^v//')
[ -n "$to" ] || { bad "can't tell the latest release"; exit 0; }
[ "$to" != "$from" ] || { bad "$from is already the latest release, so there's nothing to update to"; exit 0; }
want=$(curl -fsSL "$release/download/v$to/SHA256SUMS" | awk -v f="Channels-$to-linux-x86_64.AppImage" '$2 == f { print $1 }')
[ -n "$want" ] || { bad "the SHA256SUMS of $to list no AppImage"; exit 0; }
img="$HOME/Applications/Channels.AppImage"
mkdir -p "$HOME/Applications"
curl -fsSL -o "$img" "$release/download/v$from/Channels-$from-linux-x86_64.AppImage" || { bad "can't download $from's AppImage"; exit 0; }
chmod +x "$img"
sum() { sha256sum "$img" | cut -d' ' -f1; }
bun_of() { pgrep -f "appimage_extracted.*/Channels/bin/bun" | head -n 1; }

APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a -s "-screen 0 1280x800x24" "$img" > "$logs/update-$from.log" 2>&1 &
staged=""
for _ in $(seq 1 90); do
  for f in /tmp/kiwi-update-*/Channels-"$to"-linux-x86_64.AppImage; do
    [ -f "$f" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$want" ] && staged=$f
  done
  [ -n "$staged" ] && break
  sleep 5
done
if [ -n "$staged" ]; then ok "$from found $to and staged its AppImage, matching SHA256SUMS"; else bad "$from didn't stage $to's AppImage in 7.5 min"; fi
pid=$(bun_of)
[ -n "$pid" ] && kill -TERM "$pid"
for _ in $(seq 1 60); do
  [ "$(sum)" = "$want" ] && break
  sleep 2
done
if [ "$(sum)" = "$want" ]; then ok "on quitting, $from's AppImage was replaced by $to's"; else bad "the AppImage is still $from's after quitting"; fi
pkill -TERM -f "$img" 2> /dev/null
sleep 3
pkill -KILL -f "appimage_extracted" 2> /dev/null

APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a -s "-screen 0 1280x800x24" "$img" > "$logs/update-$to.log" 2>&1 &
sleep 25
pid=$(bun_of)
if [ -n "$pid" ]; then ok "$to's AppImage starts after the update"; else bad "the updated AppImage didn't stay up: $(tail -n 5 "$logs/update-$to.log" | tr '\n' ' ' | cut -c1-300)"; fi
[ -n "$pid" ] && kill -TERM "$pid"
sleep 3
pkill -KILL -f "appimage_extracted" 2> /dev/null
exit 0
