#!/usr/bin/env bash
set -u

usage="usage: arch.sh TEST_APP_TGZ OUT (as root in a privileged archlinux container with the host's /dev and its vkms loaded, the repo at /repo, bun on PATH)"
tgz=${1:?$usage}
out=${2:?$usage}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
mkdir -p "$out"

pacman -Syu --noconfirm > "$out/install.log" 2>&1
pacman -S --noconfirm --needed gtk3 webkit2gtk-4.1 librsvg git dbus procps-ng grim mesa which hyprland seatd swaybg >> "$out/install.log" 2>&1 || { echo "installing failed:"; tail -n 20 "$out/install.log"; exit 1; }
. /etc/os-release
echo "$PRETTY_NAME, $(Hyprland --version | head -n 1)"

owner=$(stat -c %u "$repo")
id tester > /dev/null 2>&1 || useradd -m -u "$owner" tester
app=/home/tester/app
mkdir -p "$app"
tar -xzf "$tgz" -C "$app"
[ -x "$app/bin/electrobun-launcher" ] || { echo "no bin/electrobun-launcher in $tgz"; exit 1; }
chown -R tester: /home/tester "$out"
dbus-uuidgen --ensure=/etc/machine-id 2> /dev/null

rt=$(mktemp -d)
chown tester: "$rt"
chmod 700 "$rt"
card=""
for c in /sys/class/drm/card[0-9]*; do [ "$(basename "$(readlink -f "$c/device")")" = vkms ] && card=/dev/dri/$(basename "$c"); done
[ -n "$card" ] || { echo "no vkms card under /sys/class/drm: Hyprland draws through a DRM device, so load vkms on the host first"; exit 1; }
chmod 666 "$card"
groupadd -f seat
usermod -aG seat tester
seatd -g seat > "$out/seatd.log" 2>&1 &
mkdir -p /home/tester/.config/hypr
printf '%s\n' \
  'hl.monitor({ output = "", mode = "1440x900@60", position = "auto", scale = "1" })' \
  'hl.config({' \
  '    xwayland = { enabled = false },' \
  '    animations = { enabled = false },' \
  '    decoration = { blur = { enabled = true, size = 8, passes = 2 } },' \
  '    misc = { force_default_wallpaper = 0, disable_hyprland_logo = true, disable_splash_rendering = true },' \
  '    debug = { disable_logs = false },' \
  '})' \
  'hl.on("hyprland.start", function()' \
  "    hl.dispatch(hl.dsp.exec_cmd(\"bash $here/session.sh $app $out\"))" \
  'end)' > /home/tester/.config/hypr/hyprland.lua
chown -R tester: /home/tester

rm -f "$out/done"
runuser -u tester -- env XDG_RUNTIME_DIR="$rt" XDG_SESSION_TYPE=wayland PATH="$PATH" CI="${CI:-}" LIBSEAT_BACKEND=seatd AQ_DRM_DEVICES="$card" dbus-run-session -- Hyprland > "$out/hyprland.log" 2>&1 &
pid=$!
for _ in $(seq 1 600); do
  [ -e "$out/done" ] || ! kill -0 "$pid" 2> /dev/null && break
  sleep 1
done
xwayland=$(pgrep -a -x Xwayland || true)
pkill -u tester -x Hyprland 2> /dev/null
sleep 2
find "$rt" -name hyprland.log -exec cp {} "$out/hyprland-instance.log" \; 2> /dev/null
chmod -R a+rX "$out"

cat "$out/check.log" 2> /dev/null || echo "no check.log"
result=$(cat "$out/check.code" 2> /dev/null || echo "never finished")
code=0
if [ "$result" != 0 ]; then
  echo "FAIL the glass check under Hyprland: $result"
  code=1
fi
if [ -n "$xwayland" ]; then
  echo "FAIL an Xwayland ran, so the session wasn't Wayland-only: $xwayland"
  code=1
fi
if [ "$code" -ne 0 ]; then
  echo "::group::the session's log"
  cat "$out/session.log" 2> /dev/null
  echo "::endgroup::"
  echo "::group::Hyprland's log"
  tail -n 120 "$out/hyprland.log"
  [ -f "$out/hyprland-instance.log" ] && grep -E 'ERR|CRIT|WARN' "$out/hyprland-instance.log" | tail -n 60
  echo "::endgroup::"
fi
exit "$code"
