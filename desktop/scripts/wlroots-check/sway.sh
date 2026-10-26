#!/usr/bin/env bash
set -u

usage="usage: sway.sh TEST_APP_FOLDER OUT_DIR (runs desktop/scripts/wlroots-check.ts in a Wayland-only headless sway; screenshots land in OUT_DIR)"
app=${1:?$usage}
out=${2:?$usage}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
app=$(cd "$app" && pwd)
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY XAUTHORITY GDK_BACKEND WAYLAND_DISPLAY SWAYSOCK

cat > "$out/run.sh" << EOF
#!/usr/bin/env bash
bun "$here/../wlroots-check.ts" "$app" "$out" > "$out/check.log" 2>&1
swaymsg exit
EOF
chmod +x "$out/run.sh"
cat > "$out/sway.config" << EOF
xwayland disable
default_border pixel 2
for_window [title="kiwi-helper"] floating disable
output HEADLESS-1 resolution 1440x900 bg #1e1e2e solid_color
exec "$out/run.sh"
EOF

rm -f "$out/results.json"
timeout 600 dbus-run-session -- env WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=sway \
  sway -c "$out/sway.config" > "$out/sway.log" 2>&1
echo "sway exited $?"
cat "$out/check.log" 2> /dev/null
if pgrep -x Xwayland > /dev/null; then echo "an Xwayland ran, so this session wasn't Wayland-only"; exit 1; fi
[ -s "$out/results.json" ] || { echo "the check left no results:"; tail -n 80 "$out/sway.log"; exit 1; }
bun -e 'const r = JSON.parse(await Bun.file(process.argv[1]).text()); process.exit(r.length > 0 && r.every((c) => c.ok) ? 0 : 1)' "$out/results.json" || {
  echo "::group::sway's log"
  tail -n 120 "$out/sway.log"
  echo "::endgroup::"
  exit 1
}
