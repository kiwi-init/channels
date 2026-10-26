#!/usr/bin/env bash
set -u

usage="usage: hyprland.sh TEST_APP_FOLDER OUT_DIR (runs desktop/scripts/hyprland-check.ts in a headless Hyprland on vkms, blur on, over a swaybg wallpaper; screenshots land in OUT_DIR)"
app=${1:?$usage}
out=${2:?$usage}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
app=$(cd "$app" && pwd)

before=$(ls /dev/dri/card* 2> /dev/null | sort)
sudo modprobe vkms || { echo "no vkms module on this kernel"; exit 1; }
for _ in $(seq 1 50); do
  card=$(comm -13 <(echo "$before") <(ls /dev/dri/card* 2> /dev/null | sort) | head -n 1)
  [ -n "$card" ] && break
  sleep 0.2
done
[ -n "${card:-}" ] || card=$(for c in /dev/dri/card*; do grep -qs vkms "/sys/class/drm/$(basename "$c")/device/uevent" && echo "$c"; done | head -n 1)
[ -n "${card:-}" ] || { echo "vkms gave no DRM card: $(ls -l /dev/dri)"; exit 1; }
sudo chmod 666 "$card" /dev/dri/renderD* 2> /dev/null || true
echo "Hyprland renders on $card"

export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
sudo seatd -n 3 -u "$(id -un)" -g "$(id -gn)" > "$out/seatd.log" 2>&1 3> "$out/seatd.ready" &
for _ in $(seq 1 50); do [ -S /run/seatd.sock ] && break; sleep 0.2; done
[ -S /run/seatd.sock ] || { echo "seatd didn't start:"; cat "$out/seatd.log"; exit 1; }
unset DISPLAY XAUTHORITY GDK_BACKEND WAYLAND_DISPLAY

bun -e '
const [w, h] = [1440, 900];
const px = new Uint8Array(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 3, warm = x < w / 2;
  px[i] = warm ? 240 : 40; px[i + 1] = warm ? 120 : 90; px[i + 2] = warm ? 30 : 230;
}
await Bun.write(process.argv[1], new Blob([`P6\n${w} ${h}\n255\n`, px]));
' "$out/wall.ppm"

cat > "$out/run.sh" << RUN
#!/usr/bin/env bash
bun "$here/../hyprland-check.ts" "$app" "$out" > "$out/check.log" 2>&1
hyprctl dispatch exit
RUN
chmod +x "$out/run.sh"
cat > "$out/hyprland.conf" << CONF
monitor = , 1440x900@60, 0x0, 1
misc {
  disable_hyprland_logo = true
  disable_splash_rendering = true
}
decoration {
  rounding = 10
  blur {
    enabled = true
    size = 8
    passes = 2
  }
}
animations {
  enabled = false
}
exec-once = swaybg -i $out/wall.ppm -m fill
exec-once = $out/run.sh
CONF

rm -f "$out/results.json"
timeout 600 dbus-run-session -- env LIBSEAT_BACKEND=seatd SEATD_SOCK=/run/seatd.sock AQ_DRM_DEVICES="$card" LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=Hyprland \
  Hyprland -c "$out/hyprland.conf" > "$out/hyprland.log" 2>&1
echo "Hyprland exited $?"
sudo pkill -x seatd 2> /dev/null || true
cat "$out/check.log" 2> /dev/null
[ -s "$out/results.json" ] || { echo "the check left no results:"; tail -n 80 "$out/hyprland.log"; exit 1; }
bun -e 'const r = JSON.parse(await Bun.file(process.argv[1]).text()); process.exit(r.length > 0 && r.every((c) => c.ok) ? 0 : 1)' "$out/results.json" || {
  echo "::group::Hyprland's log"
  tail -n 120 "$out/hyprland.log"
  echo "::endgroup::"
  exit 1
}
