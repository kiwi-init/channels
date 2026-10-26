#!/usr/bin/env bash
set -u

usage="usage: weston.sh TEST_APP_FOLDER OUT_DIR (runs desktop/scripts/floating-check.ts in a headless weston, a floating desktop with no blur; screenshots land in OUT_DIR)"
app=${1:?$usage}
out=${2:?$usage}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
app=$(cd "$app" && pwd)
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY XAUTHORITY GDK_BACKEND WAYLAND_DISPLAY XDG_CURRENT_DESKTOP SWAYSOCK HYPRLAND_INSTANCE_SIGNATURE

rm -f "$out/results.json"
dbus-run-session -- bash -c '
weston --backend=headless --socket=kiwi-float --width=1280 --height=800 --idle-time=0 --renderer=pixman --debug > "$2/weston.log" 2>&1 &
weston=$!
for _ in $(seq 1 50); do [ -S "$XDG_RUNTIME_DIR/kiwi-float" ] && break; sleep 0.2; done
WAYLAND_DISPLAY=kiwi-float XDG_SESSION_TYPE=wayland timeout 300 bun "$1/../floating-check.ts" "$3" "$2" > "$2/check.log" 2>&1
code=$?
kill "$weston" 2> /dev/null
exit $code
' _ "$here" "$out" "$app"
code=$?
cat "$out/check.log" 2> /dev/null
[ -s "$out/results.json" ] || { echo "the check left no results:"; tail -n 60 "$out/weston.log"; exit 1; }
exit $code
