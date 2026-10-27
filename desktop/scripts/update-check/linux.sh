#!/usr/bin/env bash
set -u
FROM=$1
TO=$2
OUT=$3
mkdir -p "$OUT/dl" "$HOME/Applications"
problems=()
img="$HOME/Applications/ChannelsLivewire.AppImage"
main_pid() { pgrep -f '/ChannelsLivewire/bin/bun' | head -n 1; }

gh release download "v$FROM" -R "$GITHUB_REPOSITORY" -p "Channels-$FROM-linux-x86_64.AppImage" -D "$OUT/dl" || exit 1
gh release download "v$TO" -R "$GITHUB_REPOSITORY" -p SHA256SUMS -D "$OUT/to" || exit 1
want=$(awk -v f="Channels-$TO-linux-x86_64.AppImage" '$2 == f { print $1 }' "$OUT/to/SHA256SUMS")
[ -n "$want" ] || { echo "SHA256SUMS of $TO lists no AppImage"; exit 1; }
cp "$OUT/dl/Channels-$FROM-linux-x86_64.AppImage" "$img"
chmod +x "$img"
echo "installed $FROM AppImage at $img ($(sha256sum "$img" | cut -c1-16))"

xvfb-run -a -s "-screen 0 1280x800x24" "$img" > "$OUT/appimage-$FROM.log" 2>&1 &
staged=""
for _ in $(seq 1 90); do
  staged=$(ls /tmp/kiwi-update-*/Channels-"$TO"-linux-x86_64.AppImage 2> /dev/null | head -n 1)
  [ -n "$staged" ] && [ "$(sha256sum "$staged" | cut -d' ' -f1)" = "$want" ] && break
  staged=""
  sleep 5
done
[ -n "$staged" ] && echo "staged: $staged" || problems+=("$FROM never staged $TO's AppImage in 7.5 min")
pid=$(main_pid)
echo "quitting $FROM (bun $pid) with SIGTERM, Electrobun's quit sequence"
[ -n "$pid" ] && kill -TERM "$pid"
for _ in $(seq 1 60); do
  [ "$(sha256sum "$img" | cut -d' ' -f1)" = "$want" ] && break
  sleep 2
done
if [ "$(sha256sum "$img" | cut -d' ' -f1)" = "$want" ]; then echo "the AppImage is now $TO's (its SHA256SUMS line)"; else problems+=("the AppImage isn't $TO's after quitting"); fi
pkill -TERM -f "$img" 2> /dev/null
sleep 3

xvfb-run -a -s "-screen 0 1280x800x24" "$img" > "$OUT/appimage-$TO.log" 2>&1 &
sleep 25
pid=$(main_pid)
if [ -n "$pid" ]; then echo "$TO's AppImage runs (bun $pid)"; else problems+=("the updated AppImage didn't stay up"); tail -n 40 "$OUT/appimage-$TO.log"; fi
[ -n "$pid" ] && kill -TERM "$pid"
sleep 3
pkill -KILL -f "$img" 2> /dev/null

find "$HOME/.local/state" -name main.log 2> /dev/null | while read -r f; do
  echo "::group::$f"
  tail -n 60 "$f"
  echo "::endgroup::"
done
if [ ${#problems[@]} -gt 0 ]; then
  printf 'FAIL %s\n' "${problems[@]}"
  exit 1
fi
echo "ok: an installed Channels Livewire $FROM AppImage updated itself to $TO"
