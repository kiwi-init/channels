#!/usr/bin/env bash
set -u
app=${1:?usage: flicker-sway.sh TEST_APP_FOLDER OUT_DIR SCALE}
out=${2:?usage: flicker-sway.sh TEST_APP_FOLDER OUT_DIR SCALE}
scale=${3:?usage: flicker-sway.sh TEST_APP_FOLDER OUT_DIR SCALE}
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
bun "$here/eb-flicker-probe.ts" "$app" "$out" wayland > "$out/probe.log" 2>&1
swaymsg exit
EOF
chmod +x "$out/run.sh"
cat > "$out/sway.config" << EOF
xwayland disable
default_border none
output HEADLESS-1 resolution 1440x900 scale $scale
exec "$out/run.sh"
EOF
timeout "${FLICKER_SWAY_TIMEOUT:-3600}" dbus-run-session -- env WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=sway \
  sway -c "$out/sway.config" > "$out/sway.log" 2>&1
echo "sway (scale $scale) exited $?"
tail -n 40 "$out/probe.log"
