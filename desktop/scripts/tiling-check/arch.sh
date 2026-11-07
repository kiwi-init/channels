#!/usr/bin/env bash
set -u

usage="usage: arch.sh sway|hyprland TEST_APP_TGZ OUT (as root in a privileged archlinux container with the host's /dev, the repo at /repo, bun on PATH)"
compositor=${1:?$usage}
tgz=${2:?$usage}
out=${3:?$usage}
case "$compositor" in sway | hyprland) ;; *) echo "$usage" >&2; exit 2 ;; esac
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
mkdir -p "$out"

pacman -Syu --noconfirm > "$out/install.log" 2>&1
stock=(gtk3 webkit2gtk-4.1 librsvg)
tools=(git dbus procps-ng grim jq mesa which foot)
case "$compositor" in
  sway) desktop=(sway) ;;
  hyprland) desktop=(hyprland seatd) ;;
esac
pacman -S --noconfirm --needed "${stock[@]}" "${tools[@]}" "${desktop[@]}" >> "$out/install.log" 2>&1 || { echo "installing failed:"; tail -n 20 "$out/install.log"; exit 1; }
. /etc/os-release
case "$compositor" in
  sway) echo "$PRETTY_NAME, $(sway --version)" ;;
  hyprland) echo "$PRETTY_NAME, $(Hyprland --version | head -n 1)" ;;
esac

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
session="bash $here/session.sh $compositor $app $out"
env=(XDG_RUNTIME_DIR="$rt" XDG_SESSION_TYPE=wayland PATH="$PATH" CI="${CI:-}")
case "$compositor" in
  sway)
    cat > /home/tester/sway.config << EOF
xwayland disable
output HEADLESS-1 resolution 1440x900
exec $session
EOF
    env+=(WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 XDG_CURRENT_DESKTOP=sway)
    run=(sway -c /home/tester/sway.config)
    ;;
  hyprland)
    card=""
    for c in /sys/class/drm/card[0-9]*; do [ "$(basename "$(readlink -f "$c/device")")" = vkms ] && card=/dev/dri/$(basename "$c"); done
    [ -n "$card" ] || { echo "no vkms card under /sys/class/drm: Hyprland draws through a DRM device, so load vkms on the host first"; exit 1; }
    chmod 666 "$card"
    groupadd -f seat
    usermod -aG seat tester
    seatd -g seat > "$out/seatd.log" 2>&1 &
    mkdir -p /home/tester/.config/hypr
    cat > /home/tester/.config/hypr/hyprland.lua << EOF
hl.monitor({ output = "", mode = "1440x900@60", position = "auto", scale = "1" })
hl.config({
    xwayland = { enabled = false },
    animations = { enabled = false },
    misc = { force_default_wallpaper = 0, disable_hyprland_logo = true, disable_splash_rendering = true },
    debug = { disable_logs = false },
})
hl.on("hyprland.start", function()
    hl.dispatch(hl.dsp.exec_cmd("$session"))
end)
EOF
    chown -R tester: /home/tester
    env+=(LIBSEAT_BACKEND=seatd AQ_DRM_DEVICES="$card")
    run=(Hyprland)
    ;;
esac

rm -f "$out/done"
runuser -u tester -- env "${env[@]}" dbus-run-session -- "${run[@]}" > "$out/$compositor.log" 2>&1 &
pid=$!
for _ in $(seq 1 1500); do
  [ -e "$out/done" ] || ! kill -0 "$pid" 2> /dev/null && break
  sleep 1
done
xwayland=$(pgrep -a -x Xwayland || true)
pkill -u tester -x sway 2> /dev/null
pkill -u tester -x Hyprland 2> /dev/null
sleep 2
find "$rt" -name hyprland.log -exec cp {} "$out/hyprland-instance.log" \; 2> /dev/null
chmod -R a+rX "$out"

code=0
for check in mods figure; do
  echo "::group::$check check under $compositor"
  cat "$out/$check.log" 2> /dev/null || echo "no $check.log"
  echo "::endgroup::"
  status=$(cat "$out/$check.code" 2> /dev/null || echo "never finished")
  if [ "$status" = 0 ]; then echo "ok   $check check under $compositor"; else echo "FAIL $check check under $compositor: $status"; code=1; fi
done
echo "::group::windows the compositor saw"
cat "$out/windows.log" 2> /dev/null
echo "::endgroup::"
if [ -n "$xwayland" ]; then echo "FAIL an Xwayland ran, so the session wasn't Wayland-only: $xwayland"; code=1; fi
if [ "$code" -ne 0 ]; then
  echo "::group::$compositor's log"
  tail -n 120 "$out/$compositor.log"
  [ -f "$out/hyprland-instance.log" ] && grep -E 'ERR|CRIT|WARN' "$out/hyprland-instance.log" | tail -n 60
  echo "::endgroup::"
fi
exit "$code"
