#!/usr/bin/env bash
set -u
FROM=$1
TO=$2
OUT=$3
mkdir -p "$OUT/dl"
problems=()
app=/Applications/Channels.app
version() { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$app/Contents/Info.plist" 2> /dev/null; }
main_pid() { pgrep -f "$app/Contents/MacOS/cottontail" | head -n 1; }

gh release download "v$FROM" -R "$GITHUB_REPOSITORY" -p "Channels-$FROM-mac-arm64.zip" -D "$OUT/dl" || exit 1
rm -rf "$app"
ditto -x -k "$OUT/dl/Channels-$FROM-mac-arm64.zip" /Applications
echo "installed $(version) at $app"
codesign --verify --deep --strict "$app" && spctl --assess --type execute --verbose=2 "$app"

tmp=$(getconf DARWIN_USER_TEMP_DIR)
open "$app"
staged=""
for _ in $(seq 1 90); do
  staged=$(ls -d "$tmp"/kiwi-update-*/Channels.app 2> /dev/null | head -n 1)
  [ -n "$staged" ] && break
  sleep 5
done
if [ -z "$staged" ]; then
  problems+=("$FROM never staged an update in 7.5 min")
else
  echo "staged: $staged ($(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$staged/Contents/Info.plist"))"
  sleep 3
fi

pid=$(main_pid)
echo "quitting $FROM (bun $pid) with SIGTERM, Electrobun's quit sequence"
[ -n "$pid" ] && kill -TERM "$pid"
for _ in $(seq 1 60); do
  [ "$(version)" = "$TO" ] && ! pgrep -f "$app/Contents/MacOS/" > /dev/null && break
  sleep 2
done
now=$(version)
echo "after quitting: $now"
[ "$now" = "$TO" ] || problems+=("the app is $now after quitting, not $TO")
[ -e "$HOME/Library/Application Support/com.kiwiinit.channels/stable/update-failed" ] && problems+=("update-failed marker: $(cat "$HOME/Library/Application Support/com.kiwiinit.channels/stable/update-failed")")
ls -d /Applications/Channels.app* "$tmp"/kiwi-update-* 2> /dev/null | sed 's/^/left: /'
codesign --verify --deep --strict "$app" || problems+=("codesign --verify fails on the updated app")
spctl --assess --type execute --verbose=2 "$app" || problems+=("Gatekeeper refuses the updated app")
grep -q "\"$TO\"" "$app/Contents/Resources/version.json" || problems+=("version.json isn't $TO: $(cat "$app/Contents/Resources/version.json")")

open "$app"
sleep 20
pid=$(main_pid)
if [ -n "$pid" ]; then echo "$TO runs (bun $pid)"; else problems+=("the updated app didn't stay up"); fi
[ -n "$pid" ] && kill -TERM "$pid"
sleep 5
find "$HOME/Library/Logs" "$HOME/Library/Application Support/com.kiwiinit.channels" -name main.log 2> /dev/null | while read -r f; do
  echo "::group::$f"
  tail -n 60 "$f"
  echo "::endgroup::"
done
if [ ${#problems[@]} -gt 0 ]; then
  printf 'FAIL %s\n' "${problems[@]}"
  exit 1
fi
echo "ok: an installed $FROM updated itself to $TO on Apple silicon"
