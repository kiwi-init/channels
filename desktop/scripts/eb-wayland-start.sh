#!/usr/bin/env bash
set -u

usage="usage: eb-wayland-start.sh ELECTROBUN_LAUNCHER [OUTPUT_SCALE] (in a Wayland session: WAYLAND_DISPLAY set)"
launcher=${1:?$usage}
scale=${2:-}
[ -n "${WAYLAND_DISPLAY:-}" ] || { echo "$usage" >&2; exit 2; }
home=$(mktemp -d)
out="$home/app.log"
problems=()

HOME="$home" WAYLAND_DEBUG=client setsid "$launcher" > "$out" 2>&1 &
pid=$!

toplevel=""
for _ in $(seq 1 60); do
  toplevel=$(grep -m 1 -oE 'get_toplevel\(new id xdg_toplevel[@#][0-9]+\)' "$out" 2> /dev/null || true)
  [ -n "$toplevel" ] && break
  kill -0 "$pid" 2> /dev/null || break
  sleep 0.5
done

if [ -z "$toplevel" ]; then
  problems+=("no Wayland window (xdg_toplevel) within 30s")
else
  echo "Wayland window: $(grep -oE 'xdg_toplevel[@#][0-9]+\.set_(app_id|title)\("[^"]*"\)' "$out" | sort -u | tr '\n' ' ')"
  sleep 5
  web=$(pgrep -s "$pid" -f WebKitWebProcess | head -n 1)
  [ -n "$web" ] || problems+=("no WebKitWebProcess of the app's own is running 5s after its window opened")
  if [ -n "${DISPLAY:-}" ]; then
    x11=$(xdotool search --class '^Channels$' 2> /dev/null | head -n 1)
    if [ -n "$x11" ]; then problems+=("the app also opened an X11 window ($x11) on XWayland ($DISPLAY)"); else echo "XWayland ($DISPLAY) holds no Channels window"; fi
  fi
  if [ -n "$scale" ]; then
    outputs=$(grep -oE 'wl_output[@#][0-9]+\.scale\([0-9]+\)' "$out" | grep -oE '[0-9]+\)$' | tr -d ')' | sort -u | tr '\n' ' ')
    buffers=$(grep -oE 'wl_surface[@#][0-9]+\.set_buffer_scale\([0-9]+\)' "$out" | grep -oE '[0-9]+\)$' | tr -d ')' | sort -u | tr '\n' ' ')
    echo "output scale: ${outputs:-none}; the app's buffer scales: ${buffers:-none}"
    [ "$outputs" = "$scale " ] || problems+=("the compositor's output scale is ${outputs:-not sent}, not $scale")
    [[ " $buffers" == *" $scale "* ]] || problems+=("the app never drew at the output scale $scale (buffer scales: ${buffers:-none}), so the compositor enlarges a blurry window")
  fi
  kill -0 "$pid" 2> /dev/null || problems+=("the app exited while its window was open")
fi

kill -TERM -- "-$pid" 2> /dev/null
for _ in $(seq 1 20); do
  pgrep -s "$pid" > /dev/null || break
  sleep 0.5
done
left=$(pgrep -s "$pid" -a || true)
if [ -n "$left" ]; then
  problems+=("still running 10s after SIGTERM: $left")
  kill -KILL -- "-$pid" 2> /dev/null
fi

if [ ${#problems[@]} -gt 0 ]; then
  echo "the app's output, without Wayland's protocol log:"
  grep -vE '^\[[ 0-9.]+\] ' "$out" | tail -n 60
  for p in "${problems[@]}"; do echo "eb-wayland-start: $p" >&2; done
  rm -rf "$home"
  exit 1
fi
if [ -n "${DISPLAY:-}" ]; then ran="though XWayland was there too"; else ran="with no X server at all"; fi
[ -n "$scale" ] && ran="$ran, drawn at the output scale $scale"
echo "the app started natively on Wayland ($WAYLAND_DISPLAY), $ran: its window is an xdg_toplevel, its web process ran, and it stopped cleanly"
rm -rf "$home"
